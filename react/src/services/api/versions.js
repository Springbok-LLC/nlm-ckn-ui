import { VERSION_ENDPOINT } from "constants/index";
import { getJson } from "./fetchWrapper";

/**
 * Fetch the ETL version of the loaded dataset and the pinned ETL version, for
 * display in the footer. The UI version is baked into the bundle, not fetched.
 * `backend_version` is returned for diagnosis but is not displayed.
 * @returns {Promise<{backend_version: string, etl_version: string, pinned_etl_version: string} | null>}
 */
export const fetchVersionInfo = async () => {
  return getJson(VERSION_ENDPOINT, { fallback: null, silent: true });
};
