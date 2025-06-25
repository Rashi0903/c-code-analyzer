import React, { useState, useEffect } from "react";
import CodeInput from "./CodeInput";
import SyntaxHighlighter from "./SyntaxHighlighter";
import TokenList from "./TokenList";
import TokenStatistics from "./TokenStatistics";
import Legend from "./Legend";
import ASTVisualizer from "./ASTVisualizer";
import SyntaxErrors from "./SyntaxErrors";
import SemanticAnalyzer from "./SemanticAnalyzer";
import SymbolTable from "./SymbolTable";
import SemanticErrors from "./SemanticErrors";
import { lexer } from "../utils/lexer";
import { parser } from "../utils/parser";
import { semanticAnalyzer } from "../utils/semanticAnalyzer";
import "../styles/components/CCompilerAnalyzer.css";

const CCompilerAnalyzer = () => {
  const [code, setCode] = useState("");
  const [tokens, setTokens] = useState([]);
  const [ast, setAst] = useState(null);
  const [syntaxErrors, setSyntaxErrors] = useState([]);
  const [symbolTable, setSymbolTable] = useState({});
  const [semanticErrors, setSemanticErrors] = useState([]);
  const [activeTab, setActiveTab] = useState("lexical");

  // New state for tracking analysis status
  const [analysisState, setAnalysisState] = useState({
    lexical: false,
    syntax: false,
    semantic: false,
  });

  // Phase 1: Lexical Analysis
  useEffect(() => {
    if (code) {
      try {
        const newTokens = lexer(code);
        setTokens(newTokens);
        setAnalysisState((prev) => ({ ...prev, lexical: true }));

        // Reset other analyses when code changes
        setAst(null);
        setSyntaxErrors([]);
        setSymbolTable({});
        setSemanticErrors([]);
        setAnalysisState((prev) => ({
          ...prev,
          syntax: false,
          semantic: false,
        }));
      } catch (error) {
        console.error("Lexer error:", error);
        setTokens([]);
        setAnalysisState((prev) => ({ ...prev, lexical: false }));
      }
    } else {
      setTokens([]);
      setAnalysisState((prev) => ({ ...prev, lexical: false }));
    }
  }, [code]);

  // Phase 2: Syntax Analysis
  const runSyntaxAnalysis = () => {
    if (tokens.length === 0) return;

    try {
      const { ast: newAst, errors } = parser(tokens);
      setAst(newAst);
      setSyntaxErrors(errors);
      setAnalysisState((prev) => ({ ...prev, syntax: true }));

      // Reset semantic analysis
      setSymbolTable({});
      setSemanticErrors([]);
      setAnalysisState((prev) => ({ ...prev, semantic: false }));

      // Automatically switch to syntax tab if no errors
      if (errors.length === 0) {
        setActiveTab("syntax");
      }
    } catch (error) {
      console.error("Parser error:", error);
      setAst(null);
      setSyntaxErrors([{ message: error.message, location: "unknown" }]);
      setAnalysisState((prev) => ({ ...prev, syntax: false }));
    }
  };

  // Phase 3: Semantic Analysis
  const runSemanticAnalysis = () => {
    if (!ast) return;

    try {
      // Pass both AST and source code to semantic analyzer
      const { symbolTable: newSymbolTable, errors } = semanticAnalyzer(
        ast,
        code
      );
      setSymbolTable(newSymbolTable);
      setSemanticErrors(errors);
      setAnalysisState((prev) => ({ ...prev, semantic: true }));

      // Automatically switch to semantic tab if no errors
      if (errors.length === 0) {
        setActiveTab("semantic");
      }
    } catch (error) {
      console.error("Semantic analyzer error:", error);
      setSymbolTable({});
      setSemanticErrors([{ message: error.message, location: "unknown" }]);
      setAnalysisState((prev) => ({ ...prev, semantic: false }));
    }
  };

  // Determine if we can proceed to the next phase
  const canRunSyntaxAnalysis = tokens.length > 0;
  const canRunSemanticAnalysis = ast && syntaxErrors.length === 0;

  return (
    <div className="container">
      <div className="code-area">
        <CodeInput code={code} setCode={setCode} />
        <div className="analysis-controls">
          <button
            className={`analyze-btn ${analysisState.lexical ? "complete" : ""}`}
            disabled={!canRunSyntaxAnalysis}
            onClick={runSyntaxAnalysis}
          >
            Run Syntax Analysis
          </button>
          <button
            className={`analyze-btn ${analysisState.syntax ? "complete" : ""}`}
            disabled={!canRunSemanticAnalysis}
            onClick={runSemanticAnalysis}
          >
            Run Semantic Analysis
          </button>
        </div>
      </div>

      <div className="analysis-area">
        <div className="tabs">
          <button
            className={`tab ${activeTab === "lexical" ? "active" : ""}`}
            onClick={() => setActiveTab("lexical")}
          >
            Lexical Analysis
          </button>
          <button
            className={`tab ${activeTab === "syntax" ? "active" : ""}`}
            onClick={() => setActiveTab("syntax")}
            disabled={!ast}
          >
            Syntax Analysis
          </button>
          <button
            className={`tab ${activeTab === "semantic" ? "active" : ""}`}
            onClick={() => setActiveTab("semantic")}
            disabled={!analysisState.semantic}
          >
            Semantic Analysis
          </button>
        </div>

        <div className="tab-content">
          {activeTab === "lexical" && (
            <>
              <h2>Syntax Highlighted Output</h2>
              <SyntaxHighlighter code={code} tokens={tokens} />
              <Legend />
              <TokenStatistics tokens={tokens} />
              <h2>Token List</h2>
              <TokenList tokens={tokens} />
            </>
          )}

          {activeTab === "syntax" && (
            <>
              <h2>Abstract Syntax Tree</h2>
              {syntaxErrors.length > 0 ? (
                <SyntaxErrors errors={syntaxErrors} code={code} />
              ) : (
                <ASTVisualizer ast={ast} />
              )}
            </>
          )}

          {activeTab === "semantic" && (
            <>
              <h2>Semantic Analysis</h2>
              {semanticErrors.length > 0 ? (
                <SemanticErrors errors={semanticErrors} code={code} />
              ) : (
                <>
                  <SemanticAnalyzer ast={ast} />
                  <h3>Symbol Table</h3>
                  {/* Pass source code to SymbolTable component */}
                  <SymbolTable symbolTable={symbolTable} sourceCode={code} />
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default CCompilerAnalyzer;
