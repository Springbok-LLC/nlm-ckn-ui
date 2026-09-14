import { humanizeSlug } from "utils/strings";

/**
 * UI-local node card section structure, keyed by collection abbreviation.
 *
 * This is a presentation-only config owned by the UI. It is intentionally
 * separate from `assets/nlm-ckn-collection-maps.json`, which is kept
 * byte-identical with the ETL repo by a sync workflow and must not carry
 * UI section tags.
 *
 * Each section may carry static `description` text (rendered even when the
 * section has no rows) and `info`, a tooltip on an icon beside the heading.
 *
 * Each field descriptor:
 *   - key:     the document property to read.
 *   - label:   the display label shown in the card (authoritative).
 *   - value:   optional; a fixed value shown instead of the document's.
 *   - variant: optional; "description" renders as a lead paragraph, not a row.
 *
 * Values and URLs for keys that also appear in the collection map are resolved
 * through `getDisplayFields` (so URL templates stay in one place). Keys not in
 * the collection map resolve their plain value straight from the document; if a
 * key is absent in the data, that field simply does not render.
 *
 * Section order and labels follow the node card specification attached to
 * nlm-ckn#327. Slots it asks for that no document carries — PMID and sex on
 * CSD, disease and embedding on CS — are omitted rather than configured, so
 * they cannot render as blank rows.
 */
const CKN_FILTERING_CRITERIA = {
  section: "CKN Filtering Criteria",
  info: "Criteria used in CKN to filter human normal adult cells",
  description:
    "Only human normal adult cells are included in CKN v1.0. Cells are filtered based on NCBI " +
    "Taxonomy ID for species, UBERON IDs for tissues traced back to the parent term of the " +
    "Anatomical Structure Collection, Human Developmental Stages (HSAPDV) Ontology for age, and " +
    "the Phenotype And Trait Ontology PATO:0000461 for normal or healthy tissue.",
  fields: [],
};

export const fieldSections = {
  CS: [
    { section: "Context", fields: [{ key: "publication", label: "Publication" }] },
    {
      section: "Provenance",
      fields: [
        { key: "cellxgene_collection", label: "CELLxGENE collection" },
        { key: "dataset_name", label: "Dataset name" },
        // Not a page: every cell set's dataset URL is a raw .h5ad, so the label
        // has to warn before the click does.
        { key: "cellxgene_dataset", label: "CELLxGENE data download (.h5ad)" },
      ],
    },
    {
      section: "Analysis Metadata",
      fields: [{ key: "cluster_annotation", label: "Cluster annotation level" }],
    },
    CKN_FILTERING_CRITERIA,
    {
      section: "Post-filtering Cell Set Metadata",
      fields: [
        { key: "species", label: "Species" },
        { key: "anatomical_structure", label: "Anatomical Structure Collection" },
      ],
    },
    {
      section: "Post-filtering Cell Set Statistics",
      fields: [
        { key: "cell_count", label: "Cell count" },
        { key: "median_silhouette", label: "Median silhouette score" },
        { key: "f_beta_score", label: "F-beta score" },
      ],
    },
    {
      section: "Markers & Selectively Expressed Genes",
      fields: [
        { key: "biomarker_combination", label: "Biomarker combination" },
        { key: "binary_gene_set", label: "Binary gene set" },
      ],
    },
    {
      // The NS-Forest metrics that score the biomarker combination.
      section: "Biomarker Combination Metrics",
      fields: [
        { key: "f_beta_score", label: "F-beta score" },
        { key: "precision", label: "Precision: TP/(TP+FP)" },
        { key: "recall", label: "Recall: TP/(TP+FN)" },
        { key: "on_target", label: "On-target fraction" },
        { key: "true_positive", label: "True positives (TP)" },
        { key: "false_positive", label: "False positives (FP)" },
        { key: "false_negative", label: "False negatives (FN)" },
        { key: "true_negative", label: "True negatives (TN)", value: "Not used in calculation" },
      ],
    },
  ],
  CSD: [
    {
      section: "Context",
      // Citation reads "Muto (2021) Nat Commun"; the collection map hangs the
      // DOI URL off the separate `publication` key.
      fields: [{ key: "Citation", label: "Publication" }],
    },
    {
      section: "Provenance",
      fields: [
        { key: "cellxgene_collection", label: "CELLxGENE collection" },
        { key: "dataset_name", label: "Dataset name" },
        // Not a page: this URL serves the raw .h5ad, hundreds of MB for a
        // typical dataset, so the label has to warn before the click does.
        { key: "cellxgene_dataset", label: "CELLxGENE data download (.h5ad)" },
      ],
    },
    {
      section: "Analysis Metadata",
      fields: [
        { key: "cluster_annotation", label: "Cluster annotation level" },
        { key: "embedding", label: "Embedding" },
      ],
    },
    CKN_FILTERING_CRITERIA,
    {
      section: "Post-filtering Dataset Metadata",
      fields: [
        { key: "species", label: "Species" },
        {
          key: "anatomical_structure",
          label: "Anatomical Structure Collection",
          transform: humanizeSlug,
        },
        { key: "tissue_annotation", label: "Tissue" },
        { key: "disease_status", label: "Disease" },
        { key: "donor_age", label: "Age" },
        // Still a bare EFO CURIE: no EFO collection exists in either graph, so
        // the UI has nothing to resolve the term name against (nlm-ckn#311).
        { key: "assay_summary", label: "Assay" },
      ],
    },
    {
      section: "Post-filtering Dataset Statistics",
      fields: [
        { key: "donor_id_count", label: "Donor count" },
        { key: "filtered_cell_count", label: "Cell count" },
        { key: "cluster_summary", label: "Cluster count" },
        { key: "median_of_median_silhouette", label: "Median of median silhouette score" },
        { key: "median_of_f_beta_scores", label: "Median F-beta score" },
      ],
    },
    {
      // Secondary quality statistics. Any other populated attribute is merged
      // in here by getSectionedFields, so naming these does not hide the rest.
      section: "Additional",
      fields: [
        { key: "mean_silhouette", label: "Mean of median silhouette score" },
        {
          key: "standard_deviation_of_silhouette",
          label: "Standard deviation of median silhouette score",
        },
        { key: "mean_f_beta_score", label: "Mean F-beta score" },
      ],
    },
  ],
};

/**
 * Collection-map attributes the node card leaves out of the "Additional"
 * catch-all. The specification removes the CSD pre-filtering total and the CS
 * expressed genes, which repeat the binary gene set.
 */
export const omittedFields = {
  CSD: ["cell_count"],
  CS: ["expressed_genes"],
};

/**
 * Parts joined after the collection name to title a node card, in order.
 * Absent parts are skipped.
 */
export const cardTitleFields = {
  CSD: [
    { key: "Citation" },
    { key: "dataset_name" },
    { key: "anatomical_structure", transform: humanizeSlug },
  ],
  // Cell sets carry the publication DOI, not the "Author (Year) Journal"
  // citation, and the anatomical structure as a UBERON CURIE.
  CS: [
    { key: "author_cell_term" },
    { key: "publication" },
    { key: "dataset_name" },
    { key: "anatomical_structure" },
  ],
};
