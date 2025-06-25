/**
 * Parser module for analyzing tokens and generating an Abstract Syntax Tree (AST)
 * This implementation handles C language syntax elements
 */

export const parser = (tokens) => {
  // Initial state for the parser
  let current = 0;
  const ast = {
    type: "Program",
    body: [],
  };
  const errors = [];

  // Helper function to peek at the current token
  const peek = () => tokens[current] || null;

  // Helper function to peek ahead n positions
  const peekAhead = (n = 1) => tokens[current + n] || null;

  // Helper function to advance to the next token
  const advance = () => {
    current++;
    return tokens[current - 1];
  };

  // Helper function to check if current token matches expected type without advancing
  const check = (type) => {
    const token = peek();
    return token && token.type === type;
  };

  // Helper function to check if current token value matches expected value without advancing
  const checkValue = (value) => {
    const token = peek();
    return token && token.value === value;
  };

  // Helper function to expect a certain token type
  const expect = (type, message) => {
    const token = peek();
    if (!token || token.type !== type) {
      errors.push({
        message:
          message ||
          `Expected token of type ${type}, got ${token?.type || "end of file"}`,
        location: token
          ? { start: token.start, end: token.end }
          : {
              start: tokens[tokens.length - 1]?.end || 0,
              end: tokens[tokens.length - 1]?.end || 0,
            },
      });
      return null;
    }
    return advance();
  };

  // Helper function to expect a certain token value
  const expectValue = (value, message) => {
    const token = peek();
    if (!token || token.value !== value) {
      errors.push({
        message:
          message ||
          `Expected '${value}', got '${token?.value || "end of file"}'`,
        location: token
          ? { start: token.start, end: token.end }
          : {
              start: tokens[tokens.length - 1]?.end || 0,
              end: tokens[tokens.length - 1]?.end || 0,
            },
      });
      return null;
    }
    return advance();
  };

  // Parsing the include directive
  const parseInclude = () => {
    const startToken = peek();
    // Consume '#include'
    advance();

    // Check for the header name in angle brackets or quotes
    const headerToken = peek();
    if (!headerToken) {
      errors.push({
        message: "Expected header name after #include",
        location: { start: startToken.start, end: startToken.end },
      });
      return null;
    }

    // Process header in angle brackets (e.g., <stdio.h>)
    if (headerToken.value === "<") {
      advance(); // Consume '<'

      // Collect all tokens until '>'
      let headerName = "";
      while (peek() && peek().value !== ">") {
        headerName += peek().value;
        advance();
      }

      // Consume '>'
      if (!expectValue(">", "Expected '>' after header name")) {
        return null;
      }

      return {
        type: "Include",
        header: headerName,
        system: true, // System header
        location: {
          start: startToken.start,
          end: peek() ? peek().end : startToken.end,
        },
      };
    }
    // Process header in quotes (e.g., "myheader.h")
    else if (headerToken.type === "string") {
      advance();
      return {
        type: "Include",
        header: headerToken.value.replace(/['"]/g, ""),
        system: false, // User header
        location: { start: startToken.start, end: headerToken.end },
      };
    } else {
      errors.push({
        message: 'Invalid include directive, expected <header> or "header"',
        location: { start: headerToken.start, end: headerToken.end },
      });
      return null;
    }
  };

  // Parse declaration specifiers (type qualifiers and type specifiers)
  const parseDeclarationSpecifiers = () => {
    const specifiers = [];
    let startPos = peek()?.start || 0;

    // Parse type qualifiers (const, volatile) and type specifiers (int, char, etc.)
    while (
      peek() &&
      (peek().type === "type" ||
        peek().type === "qualifier" ||
        peek().value === "struct" ||
        peek().value === "union" ||
        peek().value === "enum")
    ) {
      const token = advance();

      // Handle struct/union/enum
      if (
        token.value === "struct" ||
        token.value === "union" ||
        token.value === "enum"
      ) {
        const tagType = token.value;
        const tagName =
          peek() && peek().type === "identifier" ? advance().value : null;

        specifiers.push({
          type: "ComplexType",
          kind: tagType,
          name: tagName,
          location: { start: token.start, end: peek()?.end || token.end },
        });

        // Handle struct/union/enum definition
        if (peek() && peek().value === "{") {
          // Skip the struct/union/enum definition for now
          // This would be expanded in a full parser
          let braceCount = 0;
          do {
            if (peek().value === "{") braceCount++;
            if (peek().value === "}") braceCount--;
            advance();
          } while (peek() && braceCount > 0);
        }
      } else {
        // Regular type or qualifier
        specifiers.push({
          type: token.type === "qualifier" ? "TypeQualifier" : "TypeSpecifier",
          name: token.value,
          location: { start: token.start, end: token.end },
        });
      }
    }

    if (specifiers.length === 0) {
      return null;
    }

    return {
      type: "DeclarationSpecifiers",
      specifiers: specifiers,
      location: {
        start: startPos,
        end: specifiers[specifiers.length - 1].location.end,
      },
    };
  };

  // Parse variable declarator (variable name and optional initializer)
  const parseVariableDeclarator = (typeSpecifiers) => {
    const nameToken = expect("identifier", "Expected variable name");
    if (!nameToken) return null;

    let initializer = null;

    // Check for array declarator
    if (peek() && peek().value === "[") {
      advance(); // Consume '['
      const size = peek() && peek().type === "number" ? advance().value : null;
      expectValue("]", "Expected ']' after array size");

      return {
        type: "ArrayDeclarator",
        id: {
          type: "Identifier",
          name: nameToken.value,
          location: { start: nameToken.start, end: nameToken.end },
        },
        size: size !== null ? parseInt(size, 10) : null,
        location: { start: nameToken.start, end: peek()?.end || nameToken.end },
      };
    }

    // Check for initializer
    if (peek() && peek().value === "=") {
      advance(); // Consume '='
      initializer = parseExpression();
    }

    return {
      type: "VariableDeclarator",
      id: {
        type: "Identifier",
        name: nameToken.value,
        location: { start: nameToken.start, end: nameToken.end },
      },
      init: initializer,
      location: {
        start: nameToken.start,
        end: initializer ? initializer.location.end : nameToken.end,
      },
    };
  };

  // Parse variable declaration
  const parseVariableDeclaration = () => {
    const typeSpecifiers = parseDeclarationSpecifiers();

    if (!typeSpecifiers) {
      errors.push({
        message: "Expected type specifier",
        location: peek()
          ? { start: peek().start, end: peek().end }
          : { start: 0, end: 0 },
      });
      return null;
    }

    const declarators = [];

    // Parse first declarator
    const declarator = parseVariableDeclarator(typeSpecifiers);
    if (declarator) {
      declarators.push(declarator);
    }

    // Parse additional declarators (if any)
    while (peek() && peek().value === ",") {
      advance(); // Consume ','
      const nextDeclarator = parseVariableDeclarator(typeSpecifiers);
      if (nextDeclarator) {
        declarators.push(nextDeclarator);
      } else {
        break;
      }
    }

    // Expect semicolon
    expect("punctuation", "Expected ';' after variable declaration");

    return {
      type: "VariableDeclaration",
      declarations: declarators,
      typeSpecifiers: typeSpecifiers,
      location: {
        start: typeSpecifiers.location.start,
        end:
          peek()?.end ||
          (declarators.length > 0
            ? declarators[declarators.length - 1].location.end
            : typeSpecifiers.location.end),
      },
    };
  };

  // Parse a binary expression
  const parseBinaryExpression = (precedence = 0) => {
    const operators = {
      "+": { precedence: 4, associativity: "left" },
      "-": { precedence: 4, associativity: "left" },
      "*": { precedence: 5, associativity: "left" },
      "/": { precedence: 5, associativity: "left" },
      "%": { precedence: 5, associativity: "left" },
      "<": { precedence: 3, associativity: "left" },
      ">": { precedence: 3, associativity: "left" },
      "<=": { precedence: 3, associativity: "left" },
      ">=": { precedence: 3, associativity: "left" },
      "==": { precedence: 2, associativity: "left" },
      "!=": { precedence: 2, associativity: "left" },
      "&&": { precedence: 1, associativity: "left" },
      "||": { precedence: 0, associativity: "left" },
      "=": { precedence: -1, associativity: "right" }, // Added assignment operator
    };

    // Parse the left-hand side of the expression
    let left = parseUnaryExpression();
    if (!left) return null;

    // Keep processing binary operators as long as they have higher precedence
    while (
      peek() &&
      operators[peek().value] &&
      operators[peek().value].precedence >= precedence
    ) {
      const operatorToken = advance();
      const operator = operatorToken.value;
      const nextPrecedence =
        operators[operator].precedence +
        (operators[operator].associativity === "left" ? 1 : 0);

      // Parse the right-hand side with appropriate precedence
      const right = parseBinaryExpression(nextPrecedence);
      if (!right) return null;

      // Combine into a binary expression
      left = {
        type: "BinaryExpression",
        operator: operator,
        left: left,
        right: right,
        location: {
          start: left.location.start,
          end: right ? right.location.end : operatorToken.end,
        },
      };
    }

    return left;
  };

  // Parse unary expressions (!, -, ++, --, etc.)
  const parseUnaryExpression = () => {
    const unaryOperators = ["!", "-", "~", "++", "--", "&", "*"];

    if (peek() && unaryOperators.includes(peek().value)) {
      const operatorToken = advance();
      const argument = parseUnaryExpression();
      if (!argument) return null;

      return {
        type: "UnaryExpression",
        operator: operatorToken.value,
        argument: argument,
        prefix: true,
        location: {
          start: operatorToken.start,
          end: argument ? argument.location.end : operatorToken.end,
        },
      };
    }

    return parsePrimaryExpression();
  };

  // Parse primary expressions (literals, identifiers, parenthesized expressions)
  const parsePrimaryExpression = () => {
    const token = peek();

    if (!token) return null;

    // String literal
    if (token.type === "string") {
      const stringToken = advance();
      return {
        type: "Literal",
        value: stringToken.value,
        valueType: "string",
        location: { start: stringToken.start, end: stringToken.end },
      };
    }

    // Number literal
    if (token.type === "number") {
      const numberToken = advance();
      return {
        type: "Literal",
        value: numberToken.value,
        valueType: "number",
        location: { start: numberToken.start, end: numberToken.end },
      };
    }

    // Identifier or function call
    if (token.type === "identifier") {
      const identifier = advance();

      // Check for function call
      if (peek() && peek().value === "(") {
        const args = parseArguments();

        return {
          type: "CallExpression",
          callee: {
            type: "Identifier",
            name: identifier.value,
            location: { start: identifier.start, end: identifier.end },
          },
          arguments: args || [],
          location: {
            start: identifier.start,
            end: peek() ? peek().end : identifier.end,
          },
        };
      }

      // Check for array access
      if (peek() && peek().value === "[") {
        advance(); // Consume '['
        const index = parseExpression();
        expectValue("]", "Expected ']' after array index");

        return {
          type: "MemberExpression",
          object: {
            type: "Identifier",
            name: identifier.value,
            location: { start: identifier.start, end: identifier.end },
          },
          property: index,
          computed: true,
          location: {
            start: identifier.start,
            end: peek() ? peek().end : identifier.end,
          },
        };
      }

      // Just an identifier
      return {
        type: "Identifier",
        name: identifier.value,
        location: { start: identifier.start, end: identifier.end },
      };
    }

    // Parenthesized expression
    if (token.value === "(") {
      advance(); // Consume '('
      const expr = parseExpression();
      expectValue(")", "Expected ')' after expression");
      return expr;
    }

    // If we can't handle the token, advance and return null
    errors.push({
      message: `Unexpected token in expression: ${token.value}`,
      location: { start: token.start, end: token.end },
    });
    advance();
    return null;
  };

  // Parse function arguments
  const parseArguments = () => {
    const args = [];

    // Consume opening parenthesis
    expectValue("(", "Expected '(' for function arguments");

    // Empty argument list
    if (peek() && peek().value === ")") {
      advance(); // Consume ')'
      return args;
    }

    // Parse arguments
    while (true) {
      const arg = parseExpression();
      if (arg) args.push(arg);

      // Check for comma or end of argument list
      if (peek() && peek().value === ",") {
        advance(); // Consume ','
      } else {
        break;
      }
    }

    // Consume closing parenthesis
    expectValue(")", "Expected ')' after function arguments");

    return args;
  };

  // Parse expression
  const parseExpression = () => {
    return parseBinaryExpression();
  };

  // Parse a return statement
  const parseReturnStatement = () => {
    const returnToken = advance(); // Consume 'return'

    // Check if there's an expression or just a semicolon
    let argument = null;
    if (peek() && peek().value !== ";") {
      argument = parseExpression();
    }

    // Expect semicolon
    expect("punctuation", "Expected ';' after return statement");

    return {
      type: "ReturnStatement",
      argument,
      location: {
        start: returnToken.start,
        end: peek() ? peek().end : returnToken.end,
      },
    };
  };

  // Parse a block statement (compound statement)
  const parseBlockStatement = () => {
    const startToken = peek();

    // Consume opening brace
    if (!expectValue("{", "Expected '{' for block statement")) {
      return null;
    }

    const body = [];

    // Parse statements until closing brace
    while (peek() && peek().value !== "}") {
      const statement = parseStatement();
      if (statement) {
        body.push(statement);
      } else if (peek()) {
        // Skip the problematic token to avoid infinite loop
        advance();
      } else {
        break;
      }
    }

    // Consume closing brace
    if (!expectValue("}", "Expected '}' after block statement")) {
      return null;
    }

    return {
      type: "BlockStatement",
      body: body,
      location: {
        start: startToken.start,
        end: peek() ? peek().end : startToken.end,
      },
    };
  };

  // Parse if statement
  const parseIfStatement = () => {
    const startToken = peek();

    // Consume 'if'
    advance();

    // Parse condition
    if (!expectValue("(", "Expected '(' after 'if'")) {
      return null;
    }

    const test = parseExpression();

    if (!expectValue(")", "Expected ')' after if condition")) {
      return null;
    }

    // Parse consequent (then branch)
    const consequent = parseStatement();

    // Parse alternate (else branch) if it exists
    let alternate = null;
    if (peek() && peek().value === "else") {
      advance(); // Consume 'else'
      alternate = parseStatement();
    }

    return {
      type: "IfStatement",
      test: test,
      consequent: consequent,
      alternate: alternate,
      location: {
        start: startToken.start,
        end: alternate ? alternate.location.end : consequent.location.end,
      },
    };
  };

  // Parse while statement
  const parseWhileStatement = () => {
    const startToken = peek();

    // Consume 'while'
    advance();

    // Parse condition
    if (!expectValue("(", "Expected '(' after 'while'")) {
      return null;
    }

    const test = parseExpression();

    if (!expectValue(")", "Expected ')' after while condition")) {
      return null;
    }

    // Parse body
    const body = parseStatement();

    return {
      type: "WhileStatement",
      test: test,
      body: body,
      location: {
        start: startToken.start,
        end: body ? body.location.end : startToken.end,
      },
    };
  };

  // Parse for statement - Fixed to properly handle all components
  const parseForStatement = () => {
    const startToken = peek();

    // Consume 'for'
    advance();

    // Parse for loop components
    if (!expectValue("(", "Expected '(' after 'for'")) {
      return null;
    }

    // Initialize
    let init = null;
    if (peek() && peek().value !== ";") {
      // Check if it's a variable declaration
      if (peek().type === "type" || peek().type === "qualifier") {
        init = parseVariableDeclaration();
        // parseVariableDeclaration already expects and consumes the semicolon
      } else {
        // It's an expression like i = 0
        init = parseExpression();
        expectValue(";", "Expected ';' after for loop initialization");
      }
    } else {
      advance(); // Consume ';'
    }

    // Test condition
    let test = null;
    if (peek() && peek().value !== ";") {
      test = parseExpression();
    }

    expectValue(";", "Expected ';' after for loop condition");

    // Update expression
    let update = null;
    if (peek() && peek().value !== ")") {
      update = parseExpression();
    }

    expectValue(")", "Expected ')' after for loop components");

    // Body
    const body = parseStatement();

    return {
      type: "ForStatement",
      init: init,
      test: test,
      update: update,
      body: body,
      location: {
        start: startToken.start,
        end: body ? body.location.end : startToken.end,
      },
    };
  };

  // Parse a statement
  const parseStatement = () => {
    const token = peek();

    if (!token) return null;

    // Return statement
    if (token.type === "keyword" && token.value === "return") {
      return parseReturnStatement();
    }

    // Block statement
    if (token.value === "{") {
      return parseBlockStatement();
    }

    // If statement
    if (token.type === "keyword" && token.value === "if") {
      return parseIfStatement();
    }

    // While statement
    if (token.type === "keyword" && token.value === "while") {
      return parseWhileStatement();
    }

    // For statement
    if (token.type === "keyword" && token.value === "for") {
      return parseForStatement();
    }

    // Variable declaration
    if (
      token.type === "type" ||
      token.type === "qualifier" ||
      token.value === "struct" ||
      token.value === "union" ||
      token.value === "enum"
    ) {
      return parseVariableDeclaration();
    }

    // Expression statement (function calls, assignments, etc.)
    const expr = parseExpression();

    // Expect semicolon
    expect("punctuation", "Expected ';' after expression");

    if (!expr) return null;

    return {
      type: "ExpressionStatement",
      expression: expr,
      location: {
        start: expr.location.start,
        end: peek() ? peek().end : expr.location.end,
      },
    };
  };

  // Parse function parameters
  const parseParameters = () => {
    const params = [];

    // Consume opening parenthesis
    if (!expectValue("(", "Expected '(' for function parameters")) {
      return params;
    }

    // Empty parameter list
    if (peek() && peek().value === ")") {
      advance(); // Consume ')'
      return params;
    }

    // Parse parameters until closing parenthesis
    while (peek() && peek().value !== ")") {
      const typeSpecifiers = parseDeclarationSpecifiers();

      if (!typeSpecifiers) {
        errors.push({
          message: "Expected parameter type",
          location: peek()
            ? { start: peek().start, end: peek().end }
            : { start: 0, end: 0 },
        });
        break;
      }

      // Parameter name
      const nameToken = expect("identifier", "Expected parameter name");

      if (nameToken) {
        // Check for array parameter
        let isArray = false;
        if (peek() && peek().value === "[") {
          advance(); // Consume '['
          expectValue("]", "Expected ']' after array parameter");
          isArray = true;
        }

        params.push({
          type: "Parameter",
          paramType: typeSpecifiers,
          name: nameToken.value,
          isArray: isArray,
          location: {
            start: typeSpecifiers.location.start,
            end: nameToken.end,
          },
        });
      }

      // Check for comma or end of parameter list
      if (peek() && peek().value === ",") {
        advance(); // Consume ','
      } else {
        break;
      }
    }

    // Consume closing parenthesis
    expectValue(")", "Expected ')' after function parameters");

    return params;
  };

  // Parse function body
  const parseFunctionBody = () => {
    return parseBlockStatement();
  };

  // Parse function declaration
  const parseFunctionDeclaration = () => {
    const returnTypeSpecifiers = parseDeclarationSpecifiers();

    if (!returnTypeSpecifiers) {
      errors.push({
        message: "Expected function return type",
        location: peek()
          ? { start: peek().start, end: peek().end }
          : { start: 0, end: 0 },
      });
      return null;
    }

    // Function name
    const nameToken = expect("identifier", "Expected function name");

    if (!nameToken) return null;

    // Function parameters
    const params = parseParameters();

    // Function body or forward declaration
    let body = null;
    if (peek() && peek().value === "{") {
      body = parseFunctionBody();
    } else {
      // Forward declaration ends with semicolon
      expectValue(";", "Expected ';' after function forward declaration");
    }

    return {
      type: "FunctionDeclaration",
      id: {
        type: "Identifier",
        name: nameToken.value,
        location: { start: nameToken.start, end: nameToken.end },
      },
      returnType: returnTypeSpecifiers,
      params,
      body,
      location: {
        start: returnTypeSpecifiers.location.start,
        end: body ? body.location.end : peek() ? peek().end : nameToken.end,
      },
    };
  };

  // Parse a typedef statement
  const parseTypedef = () => {
    const startToken = peek();
    advance(); // Consume 'typedef'

    // Parse the type being defined
    const typeSpecifiers = parseDeclarationSpecifiers();
    if (!typeSpecifiers) {
      errors.push({
        message: "Expected type specifier after typedef",
        location: { start: startToken.start, end: startToken.end },
      });
      return null;
    }

    // Get the new type name
    const nameToken = expect(
      "identifier",
      "Expected identifier for typedef name"
    );
    if (!nameToken) return null;

    // Expect semicolon
    expectValue(";", "Expected ';' after typedef");

    return {
      type: "Typedef",
      typeSpecifiers: typeSpecifiers,
      id: {
        type: "Identifier",
        name: nameToken.value,
        location: { start: nameToken.start, end: nameToken.end },
      },
      location: {
        start: startToken.start,
        end: peek() ? peek().end : nameToken.end,
      },
    };
  };

  // Parse preprocessor directive
  const parsePreprocessorDirective = () => {
    const token = peek();

    if (token.value === "#include") {
      return parseInclude();
    } else if (token.value === "#define") {
      // For now, just skip over #define directives
      advance(); // Consume '#define'

      // Skip to end of line
      while (peek() && !peek().value.includes("\n")) {
        advance();
      }

      return {
        type: "PreprocessorDirective",
        directive: "define",
        // In a real implementation, we'd parse the macro name and value
        location: { start: token.start, end: peek() ? peek().end : token.end },
      };
    }

    // Skip unrecognized preprocessor directives
    errors.push({
      message: `Unrecognized preprocessor directive: ${token.value}`,
      location: { start: token.start, end: token.end },
    });
    advance();
    return null;
  };

  // Main parsing function
  const parseProgram = () => {
    while (current < tokens.length) {
      const token = peek();

      if (!token) break;

      try {
        // Handle different top-level constructs
        if (token.value.startsWith("#")) {
          const directive = parsePreprocessorDirective();
          if (directive) ast.body.push(directive);
        } else if (token.value === "typedef") {
          const typeDef = parseTypedef();
          if (typeDef) ast.body.push(typeDef);
        } else if (
          token.type === "type" ||
          token.type === "qualifier" ||
          token.value === "struct" ||
          token.value === "union" ||
          token.value === "enum"
        ) {
          // We need to determine if this is a function declaration or a variable declaration
          // Look ahead for a function name followed by an opening parenthesis
          const savedPosition = current;
          const typeSpecifiers = parseDeclarationSpecifiers();

          if (typeSpecifiers && peek() && peek().type === "identifier") {
            const identifierToken = peek();
            advance(); // Move past the identifier

            if (peek() && peek().value === "(") {
              // This is a function declaration, reset position and parse it properly
              current = savedPosition;
              const func = parseFunctionDeclaration();
              if (func) ast.body.push(func);
            } else {
              // This is a variable declaration, reset position and parse it properly
              current = savedPosition;
              const varDecl = parseVariableDeclaration();
              if (varDecl) ast.body.push(varDecl);
            }
          } else {
            // Reset if we couldn't determine the construct
            current = savedPosition;
            // Skip unrecognized constructs
            errors.push({
              message: `Unrecognized declaration`,
              location: { start: token.start, end: token.end },
            });
            advance();
          }
        } else if (token.type === "keyword" && token.value === "return") {
          // Handle top-level return statements (inside main function)
          const stmt = parseReturnStatement();
          if (stmt) ast.body.push(stmt);
        } else {
          // Skip unrecognized tokens
          errors.push({
            message: `Unexpected token at program level: ${token.value}`,
            location: { start: token.start, end: token.end },
          });
          advance();
        }
      } catch (e) {
        // Recover from errors by advancing to the next token
        errors.push({
          message: `Parser error: ${e.message}`,
          location: token
            ? { start: token.start, end: token.end }
            : { start: 0, end: 0 },
        });
        advance();
      }
    }

    return { ast, errors };
  };

  return parseProgram();
};
