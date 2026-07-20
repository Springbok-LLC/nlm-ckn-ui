import { Link } from "react-router-dom";

const HomePage = () => {
  return (
    <div className="home-page-layout">
      <div className="about-section-container">
        <h2 className="about-title">About NLM-CKN</h2>
        <p>
          The National Library of Medicine (NLM) Cell Knowledge Network is a knowledgebase focused
          on cell characteristics (phenotypes) derived from single-cell technologies. It integrates
          this information with data from reference ontologies, NCBI resources, and text mining
          efforts.
        </p>
        <p>
          The network is structured as a knowledge graph of biomedical entities (nodes) and their
          relationships (edges). This graph links experimental single-cell genomics data to the
          reference Cell Ontology, providing evidence for assertions and integrating information
          about cells, tissues, biomarkers, pathways, drugs, and diseases.
        </p>
        <p>
          Use the search bar in the header to find and explore entities within this network. You can
          add items to your graph or navigate to their specific pages.
          <Link to="/about" className="learn-more-link internal-learn-more">
            Learn more...
          </Link>
        </p>
      </div>
    </div>
  );
};

export default HomePage;
