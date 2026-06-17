#!/bin/bash
# ==============================================================================
# deploy-sandbox.sh - Deployment for the NLM "sandbox" account
# ==============================================================================
# The sandbox account (id 206537881715) does NOT match the cell-kn-<env>
# CloudFormation conventions the standard deploy-*.sh scripts assume, and its
# architecture differs:
#   - Frontend is served via ALB->S3 (no CloudFront, so no invalidation).
#   - Backend runs on ECS-on-EC2 and has no ECS service stood up yet, so we
#     can only build + push the image to ECR (no rolling service update).
#   - ArangoDB dataset restore uses different SSM/secret paths than dev/prod.
#
# Resource names are resolved from the stable exports/SSM contract via
# resolve-env.sh rather than from stack names.
#
# USAGE:
#   AWS_PROFILE=nlmsandbox ./scripts/sandbox/deploy-sandbox.sh [frontend|backend|all]
#     (default target: all)
#
# In CI the AWS creds come from the environment; locally set AWS_PROFILE=nlmsandbox.
#
# ENVIRONMENT VARIABLES:
#   AWS_REGION   AWS region (default: us-east-1)
#   IMAGE_TAG    Override the git SHA tag for the backend image (optional)
# ==============================================================================
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
AWS_REGION=${AWS_REGION:-us-east-1}
export AWS_REGION

TARGET="${1:-all}"

# Resolve sandbox resource names (CKN_* variables).
# shellcheck source=resolve-env.sh
source "$SCRIPT_DIR/resolve-env.sh"
resolve_env sandbox

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Cell-KN Sandbox Deployment${NC}"
echo -e "${BLUE}========================================${NC}"
echo "  Account:          $(aws sts get-caller-identity --query Account --output text)"
echo "  Frontend bucket:  ${CKN_FRONTEND_BUCKET:-(unresolved)}"
echo "  ECR image:        ${CKN_ECR_URL:-(unresolved)}"
echo "  Backend instance: ${CKN_BACKEND_INSTANCE_ID:-(unresolved)}"
echo "  Arango instance:  ${CKN_ARANGO_INSTANCE_ID:-(unresolved)}"
echo ""

# ── SSM Run Command helper ───────────────────────────────────────────────────
# Sends a shell script to an instance via SSM and waits for completion, streaming
# status and printing stdout/stderr at the end. Args: <instance-id> <script-file>
# <comment> <timeout-seconds>. Returns non-zero if the command does not succeed.
_ssm_run_and_wait() {
  local instance_id="$1" script_file="$2" comment="$3" timeout="$4"
  local command_id
  command_id=$(python3 -c "
import json, subprocess, sys
script = open('$script_file').read()
r = subprocess.run(['aws','ssm','send-command',
  '--instance-ids','$instance_id','--document-name','AWS-RunShellScript',
  '--parameters', json.dumps({'commands':[script]}),
  '--comment','$comment','--timeout-seconds','$timeout',
  '--region','$AWS_REGION','--query','Command.CommandId','--output','text'],
  capture_output=True, text=True)
if r.returncode: sys.stderr.write(r.stderr); sys.exit(1)
print(r.stdout.strip())
")
  echo "  SSM command: $command_id (instance $instance_id)"
  local elapsed=0 status
  while [ "$elapsed" -lt "$timeout" ]; do
    status=$(aws ssm get-command-invocation --command-id "$command_id" \
      --instance-id "$instance_id" --region "$AWS_REGION" \
      --query 'Status' --output text 2>/dev/null || echo Unknown)
    case "$status" in
      Success)
        aws ssm get-command-invocation --command-id "$command_id" \
          --instance-id "$instance_id" --region "$AWS_REGION" \
          --query 'StandardOutputContent' --output text
        echo -e "${GREEN}✓ SSM command succeeded${NC}"; return 0 ;;
      Failed|Cancelled|TimedOut|DeliveryTimedOut|ExecutionTimedOut)
        echo -e "${RED}SSM command $status${NC}"
        aws ssm get-command-invocation --command-id "$command_id" \
          --instance-id "$instance_id" --region "$AWS_REGION" \
          --query '{Out:StandardOutputContent,Err:StandardErrorContent}' --output text
        return 1 ;;
      *) printf "  [%ds] %s\n" "$elapsed" "$status" ;;
    esac
    sleep 15; elapsed=$((elapsed + 15))
  done
  echo -e "${RED}SSM command timed out after ${timeout}s${NC}"; return 1
}

# ── Frontend ─────────────────────────────────────────────────────────────────
deploy_frontend() {
  echo -e "${GREEN}==> Frontend${NC}"
  : "${CKN_FRONTEND_BUCKET:?Could not resolve frontend bucket (cell-kn-sandbox-frontend-bucket export)}"

  cd "$REPO_ROOT/react"
  echo -e "${YELLOW}Building React application...${NC}"
  npm ci --prefer-offline --no-audit
  npm run build-react
  [ -d build ] || { echo -e "${RED}Error: build directory not found${NC}"; exit 1; }

  echo -e "${GREEN}Syncing to s3://${CKN_FRONTEND_BUCKET}/${NC}"
  aws s3 sync build/ "s3://${CKN_FRONTEND_BUCKET}/" --delete
  # No CloudFront in sandbox (ALB->S3), so no invalidation step.
  echo -e "${GREEN}✓ Frontend deployed${NC} (URL: ${CKN_BACKEND_URL:-n/a})\n"
}

# ── Backend ──────────────────────────────────────────────────────────────────
# The backend runs as a plain `backend` docker container (port 80->8000,
# restart=unless-stopped) on an EC2 host, created by cloud-init user-data with
# its env baked in. We build + push the image to ECR (mutable tag), then via SSM
# tell the host to pull the new image and recreate the container, preserving its
# existing env / ports / restart policy (captured on the host via `docker inspect`
# so secrets never leave the instance).
deploy_backend() {
  echo -e "${GREEN}==> Backend (build, push, recreate via SSM)${NC}"
  : "${CKN_ECR_URL:?Could not resolve ECR url (/platform/cell-kn/shared/pEcrUrl)}"

  # CKN_ECR_URL is "registry/repo:tag". Keep the SSM-provided tag so the running
  # container's image reference still matches after the push.
  local registry repo_and_tag repo_path tag image_uri
  registry="${CKN_ECR_URL%%/*}"
  repo_and_tag="${CKN_ECR_URL#*/}"
  repo_path="${repo_and_tag%%:*}"
  if [ -n "${IMAGE_TAG:-}" ]; then
    tag="$IMAGE_TAG"
  elif [[ "$repo_and_tag" == *:* ]]; then
    tag="${repo_and_tag#*:}"
  else
    tag="latest"
  fi
  image_uri="${registry}/${repo_path}:${tag}"
  echo "  Image URI: $image_uri"

  echo -e "${GREEN}Logging in to ECR...${NC}"
  aws ecr get-login-password --region "$AWS_REGION" \
    | docker login --username AWS --password-stdin "$registry"

  echo -e "${GREEN}Building image (linux/amd64)...${NC}"
  docker build --platform linux/amd64 --build-arg UI_VERSION="$tag" -t "$image_uri" "$REPO_ROOT"

  echo -e "${GREEN}Pushing image...${NC}"
  docker push "$image_uri"
  echo -e "${GREEN}✓ Image pushed: ${image_uri}${NC}"

  if [ -z "${CKN_BACKEND_INSTANCE_ID:-}" ]; then
    echo -e "${YELLOW}No backend instance resolved — image is staged in ECR but the${NC}"
    echo -e "${YELLOW}container was not recreated. Check the cell-kn-sandbox-backend-tg.${NC}\n"
    return 0
  fi

  echo -e "${GREEN}Recreating backend container on ${CKN_BACKEND_INSTANCE_ID} via SSM...${NC}"
  local recreate_tmp
  recreate_tmp=$(mktemp /tmp/backend-recreate-XXXXXX.sh)
  trap 'rm -f "$recreate_tmp"' RETURN
  cat > "$recreate_tmp" <<REMOTE_EOF
#!/bin/bash
set -euo pipefail
IMAGE="$image_uri"
REGION="$AWS_REGION"
REGISTRY="\${IMAGE%%/*}"
echo "==> Logging in to ECR on host"
aws ecr get-login-password --region "\$REGION" | docker login --username AWS --password-stdin "\$REGISTRY"
echo "==> Pulling \$IMAGE"
docker pull "\$IMAGE"
# Capture the existing container's runtime config so the recreate is faithful.
RESTART=\$(docker inspect backend --format '{{.HostConfig.RestartPolicy.Name}}' 2>/dev/null || echo unless-stopped)
mapfile -t ENVS < <(docker inspect backend --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null || true)
# Reproduce published ports (e.g. 80->8000) from the running container.
PORT_ARGS=()
while IFS= read -r line; do
  [ -n "\$line" ] && PORT_ARGS+=(-p "\$line")
done < <(docker inspect backend --format '{{range \$p, \$c := .HostConfig.PortBindings}}{{range \$c}}{{.HostPort}}:{{\$p}}{{println}}{{end}}{{end}}' 2>/dev/null | sed 's#/tcp##')
ENV_ARGS=()
for e in "\${ENVS[@]}"; do [ -n "\$e" ] && ENV_ARGS+=(--env "\$e"); done
echo "==> Recreating 'backend' (restart=\$RESTART, ports=\${PORT_ARGS[*]:-none})"
docker rm -f backend 2>/dev/null || true
docker run -d --name backend --restart "\${RESTART:-unless-stopped}" \\
  "\${PORT_ARGS[@]}" "\${ENV_ARGS[@]}" "\$IMAGE"
sleep 5
docker ps --filter name=backend --format '{{.Names}} {{.Image}} {{.Status}} {{.Ports}}'
# Prune the now-dangling old image layers.
docker image prune -f >/dev/null 2>&1 || true
echo "==> Backend recreated"
REMOTE_EOF

  _ssm_run_and_wait "$CKN_BACKEND_INSTANCE_ID" "$recreate_tmp" "Backend container recreate" 600
}

# ── Dataset ──────────────────────────────────────────────────────────────────
# Runs the shared blue-green ArangoDB restore (arango-restore-remote.sh.tmpl) on
# the sandbox arango host via SSM.
#
# The dataset is taken from ETL_VERSION (repo root), which selects the standard
# S3 key format: runs/<ETL_VERSION>/06-golden-dump.tar.gz. This matches the
# structure produced by the ETL pipeline and consumed by deploy-dataset.sh.
# The sandbox SSM version parameter is updated before the restore runs so the
# on-host idempotency check (skip if already on version) works correctly.
#
# Set FORCE=true to re-restore even if the host already reports the target version.
deploy_dataset() {
  echo -e "${GREEN}==> Dataset (blue-green restore via SSM)${NC}"
  : "${CKN_ARANGO_INSTANCE_ID:?Could not resolve arango instance (cell-kn-dev-arangodb-instance-id export)}"

  # Resolve ETL_VERSION from the repo root (same source as deploy-dataset.sh).
  local etl_version_file="$REPO_ROOT/ETL_VERSION"
  if [ ! -f "$etl_version_file" ]; then
    echo -e "${RED}Error: ETL_VERSION file not found at $etl_version_file${NC}"; exit 1
  fi
  local etl_version
  etl_version=$(tr -d '[:space:]' < "$etl_version_file")
  if [ -z "$etl_version" ]; then
    echo -e "${RED}Error: ETL_VERSION file is empty${NC}"; exit 1
  fi

  # Standard S3 key format produced by the ETL pipeline.
  local dataset_s3_key="runs/${etl_version}/06-golden-dump.tar.gz"
  local dataset_bucket="cell-kn-arangodb-data-952291113202"
  local version_param="/platform/cell-kn/arango/pDatasetVersion"

  echo "  Arango instance: $CKN_ARANGO_INSTANCE_ID"
  echo "  ETL version:     $etl_version"
  echo "  S3 key:          s3://${dataset_bucket}/${dataset_s3_key}"

  # Validate the dataset exists in S3 before touching anything.
  if ! aws s3 ls "s3://${dataset_bucket}/${dataset_s3_key}" --region "$AWS_REGION" > /dev/null 2>&1; then
    echo -e "${RED}Error: Dataset not found: s3://${dataset_bucket}/${dataset_s3_key}${NC}"
    echo "Available versions:"
    aws s3 ls "s3://${dataset_bucket}/runs/" --region "$AWS_REGION" | awk '{print $2}'
    exit 1
  fi

  # Update the SSM version parameter so the on-host idempotency check and the
  # marker written after restore both reflect the correct key.
  echo "  Updating SSM ${version_param} → ${dataset_s3_key}"
  aws ssm put-parameter \
    --name "$version_param" \
    --value "$dataset_s3_key" \
    --overwrite \
    --region "$AWS_REGION" > /dev/null

  local restore_tmp
  restore_tmp=$(mktemp /tmp/arango-restore-XXXXXX.sh)
  trap 'rm -f "$restore_tmp"' RETURN
  sed \
    -e "s|__AWS_REGION__|${AWS_REGION}|g" \
    -e "s|__FORCE__|${FORCE:-false}|g" \
    -e "s|__BUCKET_PARAM__|/platform/cell-kn/arango/pArangodbBucketName|g" \
    -e "s|__VERSION_PARAM__|${version_param}|g" \
    -e "s|__PASSWORD_SECRET__|/cell-kn/sandbox/secrets/arangodb-password|g" \
    "$SCRIPT_DIR/arango-restore-remote.sh.tmpl" > "$restore_tmp"

  # The S3 download + arangorestore can take 30-60 min on large datasets.
  _ssm_run_and_wait "$CKN_ARANGO_INSTANCE_ID" "$restore_tmp" "ArangoDB dataset restore" 5400
}

case "$TARGET" in
  frontend) deploy_frontend ;;
  backend)  deploy_backend ;;
  dataset)  deploy_dataset ;;
  all)      deploy_frontend; deploy_backend; deploy_dataset ;;
  *) echo -e "${RED}Unknown target '$TARGET' (expected frontend|backend|dataset|all)${NC}"; exit 1 ;;
esac

echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✓ Sandbox deploy ($TARGET) complete${NC}"
echo -e "${BLUE}========================================${NC}"
