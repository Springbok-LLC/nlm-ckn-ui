/**
 * A row of clickable example searches, each tagged with its entity type, to show
 * the range of things the knowledge network can be searched for.
 *
 * @param {{ examples: {term: string, type: string}[], onPick: (term: string) => void }} props
 */
const ExampleSearches = ({ examples, onPick }) => {
  if (!examples || examples.length === 0) return null;

  return (
    <div className="example-searches">
      <span className="example-searches-label">Try an example:</span>
      <ul className="example-searches-list">
        {examples.map(({ term, type }) => (
          <li key={term}>
            <button type="button" className="example-search-chip" onClick={() => onPick(term)}>
              <span className="example-search-term">{term}</span>
              <span className="example-search-type">{type}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ExampleSearches;
