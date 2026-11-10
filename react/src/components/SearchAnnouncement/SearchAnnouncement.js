// Matches SEARCH_RESULT_LIMIT in arango_api/services/search_service.py.
export const SEARCH_RESULT_CAP = 50;

// Text for the screen-reader live region. Only settled states are announced:
// empty while loading or for a blank query, so "Searching..." is never read.
export const searchAnnouncement = ({
  query,
  results,
  isLoading,
  error,
  cap = SEARCH_RESULT_CAP,
}) => {
  if (!query.trim() || isLoading) return "";
  if (error) return "Search failed. Try again.";
  if (results.length === 0) return "No results found";
  if (results.length >= cap) return `${cap} or more results`;
  return `${results.length} ${results.length === 1 ? "result" : "results"}`;
};

// Always mounted so assistive technology registers later text changes.
const SearchAnnouncement = ({ query, results, isLoading, error }) => (
  <output aria-live="polite" className="visually-hidden">
    {searchAnnouncement({ query, results, isLoading, error })}
  </output>
);

export default SearchAnnouncement;
