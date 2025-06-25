/**
 * 3-Phase Semantic Analyzer for a C Compiler
 */

export const semanticAnalyzer = (ast, code) => {
  const symbolTable = {};
  const errors = [];
  const typeHierarchy = new Map(); // Track struct/union relationships

  // Helper to get line number from code and position
  const getLineNumber = (position) => {
    if (!code || position === undefined) return 1;
    try {
      return code.substring(0, position).split("\n").length;
    } catch (err) {
      return 1;
    }
  };

  // Helper to get the code line at a specific position
  const getCodeLine = (position) => {
    if (!code || position === undefined) return "";
    try {
      const lineNum = getLineNumber(position) - 1;
      return code.split("\n")[lineNum]?.trim() || "";
    } catch (err) {
      return "";
    }
  };

  // Generate unique symbol key
  const getSymbolKey = (name, scope) => {
    return `${scope}:${name}`;
  };

  // Resolve variable in scope chain
  const resolveVariable = (name, scope, scopeStack) => {
    if (!name) return null;

    for (let i = scopeStack.length - 1; i >= 0; i--) {
      const key = getSymbolKey(name, scopeStack[i]);
      if (symbolTable[key]) return symbolTable[key];
    }
    return null;
  };

  // Enhanced type compatibility checking
  const areTypesCompatible = (type1, type2) => {
    if (!type1 || !type2) return false;
    if (type1 === type2) return true;

    // Numeric type conversions
    const numericTypes = ["int", "float", "double", "char"];
    if (numericTypes.includes(type1) && numericTypes.includes(type2)) {
      // Allow implicit numeric conversions according to C rules
      if (type1 === "char" && type2 === "int") return true;
      if (type1 === "int" && (type2 === "float" || type2 === "double"))
        return true;
      if (type1 === "float" && type2 === "double") return true;
      return false;
    }

    // Pointer compatibility
    if (type1.endsWith("*") && type2.endsWith("*")) {
      const baseType1 = type1.slice(0, -1).trim();
      const baseType2 = type2.slice(0, -1).trim();
      return (
        areTypesCompatible(baseType1, baseType2) ||
        baseType1 === "void" ||
        baseType2 === "void"
      );
    }

    // Allow NULL (int 0) to be assigned to pointers
    if (type1.endsWith("*") && type2 === "int") return true;

    // Struct/union compatibility (name equivalence)
    if (typeHierarchy.has(type1) && typeHierarchy.get(type1).includes(type2)) {
      return true;
    }

    return false;
  };

  // Get expression type
  const getExpressionType = (node, scope, scopeStack) => {
    if (!node) return null;

    switch (node.type) {
      case "Identifier":
        return resolveVariable(node.name, scope, scopeStack)?.type || null;
      case "NumericLiteral":
        return typeof node.value === "string" && node.value.includes(".")
          ? "float"
          : "int";
      case "StringLiteral":
        return "char*";
      case "BooleanLiteral":
        return "int"; // C uses int for boolean values
      case "ArrayAccess": {
        const array = resolveVariable(node.array?.name, scope, scopeStack);
        if (!array) return null;
        // Remove the array brackets to get the element type
        return array.type.replace("[]", "");
      }
      case "MemberExpression":
        return node.resolvedType || null;
      case "CallExpression": {
        const func = resolveVariable(node.callee?.name, scope, scopeStack);
        return func?.returnType || null;
      }
      case "BinaryExpression": {
        const leftType = getExpressionType(node.left, scope, scopeStack);
        const rightType = getExpressionType(node.right, scope, scopeStack);

        if (
          ["==", "!=", "<", ">", "<=", ">=", "&&", "||"].includes(node.operator)
        ) {
          return "int"; // C uses int for boolean results
        }

        // For arithmetic operations, promote to the highest type
        if (leftType === "double" || rightType === "double") return "double";
        if (leftType === "float" || rightType === "float") return "float";
        return "int";
      }
      case "AssignmentExpression":
        return getExpressionType(node.left, scope, scopeStack);
      case "UnaryExpression":
        if (!node.argument) return null;

        if (node.operator === "&") {
          const argType = getExpressionType(node.argument, scope, scopeStack);
          return argType ? `${argType}*` : null;
        }
        if (node.operator === "*") {
          const argType = getExpressionType(node.argument, scope, scopeStack);
          return argType && argType.endsWith("*")
            ? argType.slice(0, -1).trim()
            : null;
        }
        if (["!", "~", "-", "+"].includes(node.operator)) {
          return getExpressionType(node.argument, scope, scopeStack);
        }
        return null;
      default:
        return null;
    }
  };

  /**
   * Phase 1: Build Symbol Table
   * - Populates the symbol table with declarations
   * - Handles scope
   */
  const buildSymbolTable = (
    node,
    scope = "global",
    scopeStack = ["global"]
  ) => {
    if (!node || typeof node !== "object") return;

    // Handle preprocessor directives
    if (node.type === "PreprocessorDirective") {
      processPreprocessorDirective(node);
      return;
    }

    // Handle struct/union declarations
    if (node.type === "StructDeclaration" || node.type === "UnionDeclaration") {
      const typeName = node.id?.name;
      if (!typeName) {
        errors.push({
          message: "Invalid struct/union declaration (missing name)",
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Struct/union declaration is malformed",
        });
        return;
      }

      const structKey = getSymbolKey(typeName, scope);
      symbolTable[structKey] = {
        name: typeName,
        type: node.type === "StructDeclaration" ? "struct" : "union",
        scope,
        line: getLineNumber(node.location?.start),
        fields:
          node.fields?.map((field) => ({
            name: field.name,
            type: field.type?.name || "unknown",
          })) || [],
        size: node.size,
      };

      typeHierarchy.set(typeName, [typeName]);

      // Add fields to symbol table with scope as struct name
      node.fields?.forEach((field) => {
        const fieldKey = getSymbolKey(field.name, typeName);
        symbolTable[fieldKey] = {
          name: field.name,
          type: field.type?.name,
          scope: typeName, // Field's scope is the struct/union name
          line: getLineNumber(field.location?.start),
          initialized: true, // fields are considered initialized
        };
      });
      return;
    }

    // Handle function declarations
    if (node.type === "FunctionDeclaration") {
      const functionName = node.id?.name;
      if (!functionName || !node.returnType?.name) {
        errors.push({
          message: "Invalid function declaration",
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Missing function name or return type",
        });
        return;
      }

      const functionKey = getSymbolKey(functionName, "global");
      symbolTable[functionKey] = {
        name: functionName,
        type: `${node.returnType.name} function`,
        returnType: node.returnType.name,
        scope: "global",
        line: getLineNumber(node.location?.start),
        params:
          node.params?.map((param) => ({
            name: param.name,
            type: param.paramType?.name || "unknown",
          })) || [],
      };

      // Enter function scope
      const functionScope = functionName;
      scopeStack.push(functionScope);

      // Process parameters
      node.params?.forEach((param) => {
        if (!param?.name || !param.paramType?.name) {
          errors.push({
            message: "Invalid parameter declaration",
            line: getLineNumber(param.location?.start),
            code: getCodeLine(param.location?.start),
            description: "Missing parameter name or type",
          });
          return;
        }

        const paramKey = getSymbolKey(param.name, functionScope);
        symbolTable[paramKey] = {
          name: param.name,
          type: param.paramType.name,
          scope: functionScope,
          line: getLineNumber(param.location?.start),
          initialized: true, // Parameters are initialized
        };
      });

      // Process function body
      if (node.body) {
        const statements = Array.isArray(node.body) ? node.body : [node.body];
        statements.forEach((stmt) =>
          buildSymbolTable(stmt, functionScope, scopeStack)
        );
      }

      scopeStack.pop();
      return;
    }

    // Handle block statements
    else if (node.type === "BlockStatement") {
      const blockScope = `block_${scopeStack.join("_")}_${Date.now()}`;
      scopeStack.push(blockScope);

      if (node.body) {
        const statements = Array.isArray(node.body) ? node.body : [node.body];
        statements.forEach((stmt) =>
          buildSymbolTable(stmt, blockScope, scopeStack)
        );
      }

      scopeStack.pop();
      return;
    }

    // Handle variable declarations
    else if (node.type === "VariableDeclaration") {
      const varName = node.id?.name;
      if (!varName || !node.varType?.name) {
        errors.push({
          message: "Invalid variable declaration",
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Missing variable name or type",
        });
        return;
      }

      const varKey = getSymbolKey(varName, scope);
      if (symbolTable[varKey]) {
        errors.push({
          message: `Redeclaration of '${varName}' in ${scope} scope`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Variable already declared in this scope",
        });
        return;
      }

      symbolTable[varKey] = {
        name: varName,
        type: node.varType.name,
        scope,
        line: getLineNumber(node.location?.start),
        initialized: node.init !== undefined, // Track initialization status
        isArray: node.isArray || false,
        arraySize: node.arraySize || null,
      };

      // If there's an initializer, process it
      if (node.init) {
        buildSymbolTable(node.init, scope, scopeStack);
      }

      return;
    }

    // Handle array declarations
    else if (node.type === "ArrayDeclaration") {
      const arrayName = node.id?.name;
      if (!arrayName || !node.elementType?.name) {
        errors.push({
          message: "Invalid array declaration",
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Missing array name or element type",
        });
        return;
      }

      const arrayKey = getSymbolKey(arrayName, scope);
      if (symbolTable[arrayKey]) {
        errors.push({
          message: `Redeclaration of array '${arrayName}' in ${scope} scope`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Array already declared in this scope",
        });
        return;
      }

      symbolTable[arrayKey] = {
        name: arrayName,
        type: `${node.elementType.name}[]`,
        scope,
        line: getLineNumber(node.location?.start),
        initialized: node.init !== undefined,
        isArray: true,
        arraySize: node.size || null,
      };

      // Process initializer if present
      if (node.init) {
        buildSymbolTable(node.init, scope, scopeStack);
      }

      return;
    }

    // Handle control structures (create new scopes)
    else if (
      ["ForStatement", "WhileStatement", "IfStatement"].includes(node.type)
    ) {
      const controlScope = `${scope}_${node.type}_${Date.now()}`;
      scopeStack.push(controlScope);

      // Process control structure parts
      if (node.init) buildSymbolTable(node.init, controlScope, scopeStack);
      if (node.test) buildSymbolTable(node.test, controlScope, scopeStack);
      if (node.update) buildSymbolTable(node.update, controlScope, scopeStack);
      if (node.body) {
        const body = Array.isArray(node.body) ? node.body : [node.body];
        body.forEach((stmt) =>
          buildSymbolTable(stmt, controlScope, scopeStack)
        );
      }
      if (node.consequent)
        buildSymbolTable(node.consequent, controlScope, scopeStack);
      if (node.alternate)
        buildSymbolTable(node.alternate, controlScope, scopeStack);

      scopeStack.pop();
      return;
    }

    // Handle assignments (to mark variables as initialized)
    else if (node.type === "AssignmentExpression") {
      if (node.left?.type === "Identifier") {
        const varName = node.left.name;
        const varSymbol = resolveVariable(varName, scope, scopeStack);

        if (varSymbol) {
          const varKey = Object.keys(symbolTable).find(
            (key) => symbolTable[key] === varSymbol
          );
          if (varKey) {
            symbolTable[varKey].initialized = true;
          }
        }
      }

      // Process both sides of the assignment
      if (node.left) buildSymbolTable(node.left, scope, scopeStack);
      if (node.right) buildSymbolTable(node.right, scope, scopeStack);
      return;
    } else if (node.type === "CallExpression") {
      const funcName = node.callee?.name;
      const funcSymbol = resolveVariable(funcName, scope, scopeStack);

      if (!funcSymbol) return; // Already reported in Phase 2

      const expectedParams = funcSymbol.params || [];
      const args = node.arguments || [];

      // Check each argument type against parameter type
      args.forEach((arg, index) => {
        checkSemantics(arg, scope, scopeStack); // Check the argument expression

        if (index < expectedParams.length) {
          const argType = getExpressionType(arg, scope, scopeStack);
          const paramType = expectedParams[index].type;

          if (argType && paramType && !areTypesCompatible(paramType, argType)) {
            errors.push({
              message: `Argument ${
                index + 1
              } type mismatch: expected ${paramType}, got ${argType}`,
              line: getLineNumber(arg.location?.start),
              code: getCodeLine(arg.location?.start),
              description: "Type mismatch in function argument",
            });
          }
        }
      });
    }
    // Handle function calls

    // Handle program root
    else if (node.type === "Program" && node.body) {
      const body = Array.isArray(node.body) ? node.body : [node.body];
      body.forEach((n) => buildSymbolTable(n, scope, scopeStack));
    }
  };

  /**
   * Phase 2: Type Resolution and Initial Type Checking
   * - Resolves type names
   * - Performs initial type compatibility checks
   */
  const resolveTypes = (node, scope = "global", scopeStack = ["global"]) => {
    if (!node || typeof node !== "object") return;

    if (node.type === "VariableDeclaration") {
      const varType = node.varType?.name;
      const varName = node.id?.name;
      const varKey = getSymbolKey(varName, scope);
      const symbol = symbolTable[varKey];

      if (!symbol) return; // Should have been declared in phase 1

      // If there's an initializer, check type compatibility
      if (node.init) {
        resolveTypes(node.init, scope, scopeStack);
        const initType = getExpressionType(node.init, scope, scopeStack);

        if (initType && !areTypesCompatible(symbol.type, initType)) {
          errors.push({
            message: `Type mismatch in initialization of ${varName}: cannot assign ${initType} to ${symbol.type}`,
            line: getLineNumber(node.location?.start),
            code: getCodeLine(node.location?.start),
            description: "Type mismatch in variable initialization",
          });
        }
      }
    } else if (node.type === "ArrayDeclaration") {
      const arrayName = node.id?.name;
      const arrayKey = getSymbolKey(arrayName, scope);
      const symbol = symbolTable[arrayKey];

      if (!symbol) return;

      // If there's an initializer, process it
      if (node.init) {
        resolveTypes(node.init, scope, scopeStack);
      }
    } else if (node.type === "FunctionDeclaration") {
      const functionName = node.id?.name;
      const functionScope = functionName;
      scopeStack.push(functionScope);

      // Resolve parameter types
      if (node.params) {
        node.params.forEach((param) =>
          resolveTypes(param, functionScope, scopeStack)
        );
      }

      // Resolve types in function body
      if (node.body) {
        const statements = Array.isArray(node.body) ? node.body : [node.body];
        statements.forEach((stmt) =>
          resolveTypes(stmt, functionScope, scopeStack)
        );
      }

      scopeStack.pop();
    } else if (node.type === "BlockStatement") {
      const blockScope = scopeStack[scopeStack.length - 1];
      if (node.body) {
        const statements = Array.isArray(node.body) ? node.body : [node.body];
        statements.forEach((stmt) =>
          resolveTypes(stmt, blockScope, scopeStack)
        );
      }
    } else if (node.type === "MemberExpression") {
      const structName = node.object?.name;
      const memberName = node.property?.name;
      const structSymbol = resolveVariable(structName, scope, scopeStack);

      if (!structSymbol) return;

      if (structSymbol.type !== "struct" && structSymbol.type !== "union") {
        errors.push({
          message: `Invalid member access on non-struct/union type '${structName}'`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Member access on non-struct/union",
        });
        return;
      }

      const memberKey = getSymbolKey(memberName, structSymbol.name);
      const memberSymbol = symbolTable[memberKey];
      if (!memberSymbol) {
        errors.push({
          message: `Member '${memberName}' not found in struct/union '${structName}'`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Invalid member access",
        });
        return;
      }

      node.resolvedType = memberSymbol.type; // Store resolved type for later use
    } else if (node.type === "CallExpression") {
      const funcName = node.callee?.name;
      const funcSymbol = resolveVariable(funcName, scope, scopeStack);

      if (!funcSymbol) {
        errors.push({
          message: `Undefined function '${funcName}'`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Function called without declaration",
        });
        return;
      }

      // Check argument count
      const expectedParams = funcSymbol.params || [];
      const args = node.arguments || [];

      if (args.length !== expectedParams.length) {
        errors.push({
          message: `Function '${funcName}' expects ${expectedParams.length} arguments, got ${args.length}`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Incorrect number of arguments",
        });
      }

      // Process arguments
      args.forEach((arg) => resolveTypes(arg, scope, scopeStack));
    } else if (node.type === "AssignmentExpression") {
      resolveTypes(node.left, scope, scopeStack);
      resolveTypes(node.right, scope, scopeStack);

      const leftType = getExpressionType(node.left, scope, scopeStack);
      const rightType = getExpressionType(node.right, scope, scopeStack);

      if (leftType && rightType && !areTypesCompatible(leftType, rightType)) {
        errors.push({
          message: `Type mismatch in assignment: cannot assign ${rightType} to ${leftType}`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Type mismatch in assignment",
        });
      }
    } else if (node.type === "BinaryExpression") {
      resolveTypes(node.left, scope, scopeStack);
      resolveTypes(node.right, scope, scopeStack);

      const leftType = getExpressionType(node.left, scope, scopeStack);
      const rightType = getExpressionType(node.right, scope, scopeStack);

      // Check for division by zero
      if (
        node.operator === "/" &&
        node.right?.type === "NumericLiteral" &&
        Number(node.right.value) === 0
      ) {
        errors.push({
          message: "Division by zero",
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Potential division by zero",
        });
      }

      // Check type compatibility for operators
      if (leftType && rightType && !areTypesCompatible(leftType, rightType)) {
        errors.push({
          message: `Type mismatch in ${node.operator}: ${leftType} vs ${rightType}`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Incompatible types in binary operation",
        });
      }
    } else if (node.type === "Program" && node.body) {
      const body = Array.isArray(node.body) ? node.body : [node.body];
      body.forEach((n) => resolveTypes(n, scope, scopeStack));
    }
  };

  /**
   * Phase 3: Semantic Checks
   * - Performs full semantic and usage checks based on the symbol table
   */
  const checkSemantics = (node, scope = "global", scopeStack = ["global"]) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "Identifier") {
      const variable = resolveVariable(node.name, scope, scopeStack);
      if (!variable) {
        errors.push({
          message: `Undefined identifier '${node.name}'`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Use of undeclared identifier",
        });
        return;
      }

      // Check if variable is used before initialization
      if (!variable.initialized && !variable.type.includes("function")) {
        errors.push({
          message: `Use of uninitialized variable '${node.name}'`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Variable used before initialization",
        });
      }
    } else if (node.type === "CallExpression") {
      const funcName = node.callee?.name;
      const funcSymbol = resolveVariable(funcName, scope, scopeStack);

      if (!funcSymbol) {
        errors.push({
          message: `Undefined function '${funcName}'`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Function called without declaration",
        });
        return;
      }

      // Check argument count
      const expectedParams = funcSymbol.params || [];
      const args = node.arguments || [];

      if (args.length !== expectedParams.length) {
        errors.push({
          message: `Function '${funcName}' expects ${expectedParams.length} arguments, got ${args.length}`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Incorrect number of arguments",
        });
      }

      // Process arguments and check for undefined identifiers
      args.forEach((arg, index) => {
        resolveTypes(arg, scope, scopeStack);

        // Check if argument is a direct identifier and validate it exists
        if (arg.type === "Identifier") {
          const argVar = resolveVariable(arg.name, scope, scopeStack);
          if (!argVar) {
            errors.push({
              message: `Undefined identifier '${arg.name}' in function call`,
              line: getLineNumber(arg.location?.start),
              code: getCodeLine(arg.location?.start),
              description: "Use of undeclared identifier in function argument",
            });
          }
        }
      });
    } else if (node.type === "BinaryExpression") {
      checkSemantics(node.left, scope, scopeStack);
      checkSemantics(node.right, scope, scopeStack);

      // Additional logical operator checks
      if (["&&", "||"].includes(node.operator)) {
        const leftType = getExpressionType(node.left, scope, scopeStack);
        const rightType = getExpressionType(node.right, scope, scopeStack);

        // Logical operators typically operate on int/boolean values in C
        if (
          leftType &&
          !["int", "char", "float", "double"].includes(leftType)
        ) {
          errors.push({
            message: `Invalid operand to logical operator '${node.operator}': ${leftType}`,
            line: getLineNumber(node.left.location?.start),
            code: getCodeLine(node.left.location?.start),
            description: "Non-scalar used in logical operation",
          });
        }

        if (
          rightType &&
          !["int", "char", "float", "double"].includes(rightType)
        ) {
          errors.push({
            message: `Invalid operand to logical operator '${node.operator}': ${rightType}`,
            line: getLineNumber(node.right.location?.start),
            code: getCodeLine(node.right.location?.start),
            description: "Non-scalar used in logical operation",
          });
        }
      }
    } else if (node.type === "ArrayAccess") {
      const arrayName = node.array?.name;
      const array = resolveVariable(arrayName, scope, scopeStack);

      if (!array) {
        errors.push({
          message: `Undefined array '${arrayName}'`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Use of undeclared array",
        });
        return;
      }

      if (!array.isArray) {
        errors.push({
          message: `Invalid array access on non-array '${arrayName}'`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Array access on non-array type",
        });
      }

      checkSemantics(node.index, scope, scopeStack);
      const indexType = getExpressionType(node.index, scope, scopeStack);
      if (indexType && !["int", "char"].includes(indexType)) {
        errors.push({
          message: `Array index must be integer, got ${indexType}`,
          line: getLineNumber(node.index?.location?.start),
          code: getCodeLine(node.index?.location?.start),
          description: "Invalid array index type",
        });
      }

      // Check for constant array index out of bounds
      if (array.arraySize && node.index?.type === "NumericLiteral") {
        const indexValue = parseInt(node.index.value);
        if (
          !isNaN(indexValue) &&
          (indexValue < 0 || indexValue >= array.arraySize)
        ) {
          errors.push({
            message: `Array index ${indexValue} out of bounds for array of size ${array.arraySize}`,
            line: getLineNumber(node.index.location?.start),
            code: getCodeLine(node.index.location?.start),
            description: "Array index out of bounds",
          });
        }
      }
    } else if (node.type === "AssignmentExpression") {
      checkSemantics(node.left, scope, scopeStack);
      checkSemantics(node.right, scope, scopeStack);

      // Check for assignment to const or read-only values
      if (node.left?.type === "Identifier") {
        const leftVar = resolveVariable(node.left.name, scope, scopeStack);
        if (leftVar && leftVar.isConst) {
          errors.push({
            message: `Cannot assign to const variable '${node.left.name}'`,
            line: getLineNumber(node.location?.start),
            code: getCodeLine(node.location?.start),
            description: "Assignment to read-only variable",
          });
        }
      }
    } else if (node.type === "ReturnStatement") {
      // Find the function scope
      const functionScope = scopeStack.find((s) => !s.startsWith("block_"));
      if (functionScope === "global") {
        errors.push({
          message: "Return statement outside function",
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Return statements must be inside functions",
        });
        return;
      }

      const functionSymbol = Object.values(symbolTable).find(
        (s) => s.name === functionScope && s.type.includes("function")
      );

      if (!functionSymbol) return;

      // Check return type
      if (node.argument) {
        checkSemantics(node.argument, scope, scopeStack);
        const returnType = getExpressionType(node.argument, scope, scopeStack);

        if (
          returnType &&
          !areTypesCompatible(functionSymbol.returnType, returnType)
        ) {
          errors.push({
            message: `Return type mismatch: expected ${functionSymbol.returnType}, got ${returnType}`,
            line: getLineNumber(node.location?.start),
            code: getCodeLine(node.location?.start),
            description: "Incorrect return type",
          });
        }
      } else if (functionSymbol.returnType !== "void") {
        errors.push({
          message: `Missing return value for ${functionSymbol.returnType} function`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Non-void function requires return value",
        });
      }
    } else if (node.type === "ForStatement" || node.type === "WhileStatement") {
      // Check condition type
      if (node.test) {
        checkSemantics(node.test, scope, scopeStack);
        const testType = getExpressionType(node.test, scope, scopeStack);

        if (
          testType &&
          !["int", "char", "float", "double", "bool"].includes(testType) &&
          !testType.endsWith("*")
        ) {
          errors.push({
            message: `Condition must be scalar type, got ${testType}`,
            line: getLineNumber(node.test.location?.start),
            code: getCodeLine(node.test.location?.start),
            description: "Non-scalar used in loop condition",
          });
        }
      }

      // Process other parts of the loop
      if (node.init) checkSemantics(node.init, scope, scopeStack);
      if (node.update) checkSemantics(node.update, scope, scopeStack);
      if (node.body) {
        const body = Array.isArray(node.body) ? node.body : [node.body];
        body.forEach((stmt) => checkSemantics(stmt, scope, scopeStack));
      }
    } else if (node.type === "IfStatement") {
      // Check condition type
      if (node.test) {
        checkSemantics(node.test, scope, scopeStack);
        const testType = getExpressionType(node.test, scope, scopeStack);

        if (
          testType &&
          !["int", "char", "float", "double", "bool"].includes(testType) &&
          !testType.endsWith("*")
        ) {
          errors.push({
            message: `Condition must be scalar type, got ${testType}`,
            line: getLineNumber(node.test.location?.start),
            code: getCodeLine(node.test.location?.start),
            description: "Non-scalar used in if condition",
          });
        }
      }

      // Process consequent and alternate
      if (node.consequent) checkSemantics(node.consequent, scope, scopeStack);
      if (node.alternate) checkSemantics(node.alternate, scope, scopeStack);
    } else if (node.type === "SwitchStatement") {
      // Check switch expression type
      if (node.discriminant) {
        checkSemantics(node.discriminant, scope, scopeStack);
        const exprType = getExpressionType(
          node.discriminant,
          scope,
          scopeStack
        );

        if (exprType && !["int", "char", "enum"].includes(exprType)) {
          errors.push({
            message: `Switch expression must be integer type, got ${exprType}`,
            line: getLineNumber(node.discriminant.location?.start),
            code: getCodeLine(node.discriminant.location?.start),
            description: "Invalid switch expression type",
          });
        }
      }

      // Process cases
      if (node.cases) {
        node.cases.forEach((caseNode) =>
          checkSemantics(caseNode, scope, scopeStack)
        );
      }
    } else if (node.type === "UnaryExpression") {
      checkSemantics(node.argument, scope, scopeStack);

      // Check address-of operator
      if (node.operator === "&") {
        if (
          node.argument?.type !== "Identifier" &&
          node.argument?.type !== "MemberExpression" &&
          node.argument?.type !== "ArrayAccess"
        ) {
          errors.push({
            message: "Cannot take address of rvalue",
            line: getLineNumber(node.location?.start),
            code: getCodeLine(node.location?.start),
            description: "Invalid operand to address-of operator",
          });
        }
      }

      // Check dereference operator
      else if (node.operator === "*") {
        const argType = getExpressionType(node.argument, scope, scopeStack);
        if (argType && !argType.endsWith("*")) {
          errors.push({
            message: `Cannot dereference non-pointer type ${argType}`,
            line: getLineNumber(node.location?.start),
            code: getCodeLine(node.location?.start),
            description: "Dereferencing non-pointer type",
          });
        }
      }
    } else if (node.type === "Program" && node.body) {
      const body = Array.isArray(node.body) ? node.body : [node.body];
      body.forEach((n) => checkSemantics(n, scope, scopeStack));
    }
  };

  // Check assignment expression specifically
  const checkAssignment = (node, scope, scopeStack) => {
    if (!node?.left || node.type !== "AssignmentExpression") return;

    // Handle identifier on the left
    if (node.left.type === "Identifier") {
      const varName = node.left.name;
      const variable = resolveVariable(varName, scope, scopeStack);

      if (!variable) {
        errors.push({
          message: `Undefined variable '${varName}'`,
          line: getLineNumber(node.left.location?.start),
          code: getCodeLine(node.left.location?.start),
          description: "Assignment to undeclared variable",
        });
        return;
      }

      if (node.right) {
        checkSemantics(node.right, scope, scopeStack);
        const leftType = variable.type;
        const rightType = getExpressionType(node.right, scope, scopeStack);

        if (leftType && rightType && !areTypesCompatible(leftType, rightType)) {
          errors.push({
            message: `Type mismatch: cannot assign ${rightType} to ${leftType}`,
            line: getLineNumber(node.location?.start),
            code: getCodeLine(node.location?.start),
            description: "Type mismatch in assignment",
          });
        }
      }

      // Update initialization status
      const varKey = Object.keys(symbolTable).find(
        (key) => symbolTable[key] === variable
      );
      if (varKey) symbolTable[varKey].initialized = true;
    }
    // Handle array access on the left
    else if (node.left.type === "ArrayAccess") {
      checkSemantics(node.left, scope, scopeStack);
      checkSemantics(node.right, scope, scopeStack);

      const leftType = getExpressionType(node.left, scope, scopeStack);
      const rightType = getExpressionType(node.right, scope, scopeStack);

      if (leftType && rightType && !areTypesCompatible(leftType, rightType)) {
        errors.push({
          message: `Type mismatch: cannot assign ${rightType} to array element of type ${leftType}`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Type mismatch in array assignment",
        });
      }
    }
    // Handle member access on the left
    else if (node.left.type === "MemberExpression") {
      checkSemantics(node.left, scope, scopeStack);
      checkSemantics(node.right, scope, scopeStack);

      const leftType = getExpressionType(node.left, scope, scopeStack);
      const rightType = getExpressionType(node.right, scope, scopeStack);

      if (leftType && rightType && !areTypesCompatible(leftType, rightType)) {
        errors.push({
          message: `Type mismatch: cannot assign ${rightType} to struct/union member of type ${leftType}`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Type mismatch in struct/union member assignment",
        });
      }
    }
    // Handle pointer dereference on the left
    else if (
      node.left.type === "UnaryExpression" &&
      node.left.operator === "*"
    ) {
      checkSemantics(node.left, scope, scopeStack);
      checkSemantics(node.right, scope, scopeStack);

      const ptrType = getExpressionType(node.left.argument, scope, scopeStack);
      if (!ptrType || !ptrType.endsWith("*")) {
        errors.push({
          message: "Cannot dereference non-pointer in assignment",
          line: getLineNumber(node.left.location?.start),
          code: getCodeLine(node.left.location?.start),
          description: "Dereferencing non-pointer type in assignment",
        });
        return;
      }

      const leftType = ptrType.slice(0, -1).trim(); // Remove the * from pointer type
      const rightType = getExpressionType(node.right, scope, scopeStack);

      if (leftType && rightType && !areTypesCompatible(leftType, rightType)) {
        errors.push({
          message: `Type mismatch: cannot assign ${rightType} to dereferenced pointer of type ${leftType}`,
          line: getLineNumber(node.location?.start),
          code: getCodeLine(node.location?.start),
          description: "Type mismatch in pointer assignment",
        });
      }
    }
  };

  // Add standard library functions
  const addStandardLibraryFunctions = () => {
    const stdFuncs = [
      {
        name: "printf",
        returnType: "int",
        params: [{ name: "format", type: "char*" }],
      },
      {
        name: "scanf",
        returnType: "int",
        params: [{ name: "format", type: "char*" }],
      },
      {
        name: "malloc",
        returnType: "void*",
        params: [{ name: "size", type: "size_t" }],
      },
      {
        name: "free",
        returnType: "void",
        params: [{ name: "ptr", type: "void*" }],
      },
      {
        name: "strcpy",
        returnType: "char*",
        params: [
          { name: "dest", type: "char*" },
          { name: "src", type: "char*" },
        ],
      },
      {
        name: "strlen",
        returnType: "size_t",
        params: [{ name: "str", type: "char*" }],
      },
      {
        name: "fopen",
        returnType: "FILE*",
        params: [
          { name: "filename", type: "char*" },
          { name: "mode", type: "char*" },
        ],
      },
      {
        name: "fclose",
        returnType: "int",
        params: [{ name: "stream", type: "FILE*" }],
      },
      {
        name: "exit",
        returnType: "void",
        params: [{ name: "status", type: "int" }],
      },
    ];

    stdFuncs.forEach((func) => {
      const key = getSymbolKey(func.name, "global");
      if (!symbolTable[key]) {
        symbolTable[key] = {
          name: func.name,
          type: `${func.returnType} function`,
          returnType: func.returnType,
          scope: "builtin",
          line: 0,
          initialized: true,
          params: func.params,
        };
      }
    });
  };

  // Process preprocessor directives
  const processPreprocessorDirective = (node) => {
    if (!node.value) return;

    // Handle #include directives
    if (node.value.startsWith("#include")) {
      if (node.value.includes("<stdio.h>")) {
        addStandardLibraryFunctions(); // Add stdio.h functions
      } else if (node.value.includes("<stdlib.h>")) {
        // Add stdlib.h functions (malloc, free, exit, etc.)
        // These are already added in addStandardLibraryFunctions for simplicity
      } else if (node.value.includes("<string.h>")) {
        // Already covered in addStandardLibraryFunctions
      }
    }
    // Handle #define directives (simplified)
    else if (node.value.startsWith("#define")) {
      // Extract macro name and value (very simplified)
      const parts = node.value.trim().split(/\s+/);
      if (parts.length >= 3) {
        const macroName = parts[1];
        const macroValue = parts.slice(2).join(" ");

        // Add to symbol table as a special type
        const macroKey = getSymbolKey(macroName, "global");
        symbolTable[macroKey] = {
          name: macroName,
          type: "macro",
          value: macroValue,
          scope: "global",
          line: getLineNumber(node.location?.start),
          initialized: true,
        };
      }
    }
  };

  // Perform final checks
  const performChecks = () => {
    // Check for missing main function in non-simple programs
    const isSimpleProgram = code?.trim().startsWith("#include");

    if (!isSimpleProgram && !symbolTable[getSymbolKey("main", "global")]) {
      errors.push({
        message: "Missing main function",
        line: 1,
        code: "",
        description: "C program requires a main function",
      });
    }

    // Check for unused variables
    Object.values(symbolTable).forEach((symbol) => {
      // Skip functions, built-ins, and already initialized variables
      if (
        symbol.type.includes("function") ||
        symbol.scope === "builtin" ||
        symbol.initialized
      ) {
        return;
      }

      // Warning for unused variables
      errors.push({
        message: `Unused variable '${symbol.name}'`,
        line: symbol.line,
        code: getCodeLine(symbol.line), // Approximate
        description: "Variable declared but never used",
        severity: "warning", // Mark as warning
      });
    });

    // Format symbol table for display
    const displaySymbolTable = {};
    for (const [key, symbol] of Object.entries(symbolTable)) {
      const displayName =
        symbol.scope === "global"
          ? symbol.name
          : `${symbol.scope}.${symbol.name}`;

      displaySymbolTable[displayName] = {
        type: symbol.type,
        scope: symbol.scope,
        line: symbol.line,
        initialized: symbol.initialized,
        ...(symbol.params && { params: symbol.params }),
        ...(symbol.fields && { fields: symbol.fields }),
        ...(symbol.isArray && {
          isArray: symbol.isArray,
          arraySize: symbol.arraySize,
        }),
        ...(symbol.value && { value: symbol.value }),
      };
    }

    return { symbolTable: displaySymbolTable, errors };
  };

  // Main analysis function
  try {
    // Handle simple preprocessor-only programs
    if (code?.trim().startsWith("#include")) {
      processPreprocessorDirective({ value: code });
    } else {
      // Phase 1: Build Symbol Table
      buildSymbolTable(ast);

      // Phase 2: Resolve Types
      resolveTypes(ast);

      // Phase 3: Check Semantics
      checkSemantics(ast);
    }

    return performChecks();
  } catch (err) {
    errors.push({
      message: `Semantic analysis failed: ${err.message}`,
      line: 1,
      code: code?.split("\n")[0]?.trim() || "",
      description: "Internal semantic analyzer error",
    });
    return { symbolTable: {}, errors };
  }
};
