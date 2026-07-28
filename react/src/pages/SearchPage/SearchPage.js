import ExampleSearches from "components/ExampleSearches";
import NetworkStats from "components/NetworkStats";
import SearchBar from "components/SearchBar";
import { GraphContext } from "contexts";
import { useSearch } from "hooks";
import { useContext } from "react";
import { Link } from "react-router-dom";

// Example searches spanning different entity types, to show the range of things
// the knowledge network can be searched for.
const EXAMPLES = [
  { term: "respiratory system", type: "Anatomical structure" },
  { term: "pericyte", type: "Cell type" },
  { term: "KCNK3", type: "Gene" },
  { term: "pulmonary hypertension", type: "Disease" },
  { term: "Sikkema", type: "Publication" },
];

const SearchPage = () => {
  const { graphType } = useContext(GraphContext);
  const search = useSearch(graphType);

  const handlePickExample = (term) => {
    search.setQuery(term);
    search.setIsOpen(true);
  };

  return (
    <div className="search-page-layout">
      <div className="main-search-box">
        <h1 className="search-page-title">Search the Knowledge Network</h1>
        <div className="search-bar-wrapper">
          <SearchBar search={search} />
        </div>
        <ExampleSearches examples={EXAMPLES} onPick={handlePickExample} />
      </div>

      <NetworkStats />

      <p className="search-page-about">
        The NLM Cell Knowledge Network integrates single-cell phenotype data with reference
        ontologies and trusted resources into one knowledge graph.{" "}
        <Link to="/about" className="learn-more-link internal-learn-more">
          Learn more →
        </Link>
      </p>
    </div>
  );
};

export default SearchPage;
