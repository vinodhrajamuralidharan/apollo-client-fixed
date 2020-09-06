import * as fs from "fs";
import * as path from "path";
import { distDir, eachFile, reparse, reprint } from './helpers';

eachFile(distDir, (file, relPath) => {
  const source = fs.readFileSync(file, "utf8");
  const output = transform(source, relPath);
  if (source !== output) {
    fs.writeFileSync(file, output, "utf8");
  }
}).then(() => {
  fs.writeFileSync(
    path.join(distDir, "invariantErrorCodes.js"),
    recast.print(errorCodeManifest, {
      tabWidth: 2,
    }).code + "\n",
  );
});

import * as recast from "recast";
const b = recast.types.builders;
const n = recast.types.namedTypes;
type Node = recast.types.namedTypes.Node;
type NumericLiteral = recast.types.namedTypes.NumericLiteral;
type CallExpression = recast.types.namedTypes.CallExpression;
type NewExpression = recast.types.namedTypes.NewExpression;
let nextErrorCode = 1;

const errorCodeManifest = b.objectExpression([
  b.property("init",
    b.stringLiteral("@apollo/client version"),
    b.stringLiteral(require("../package.json").version),
  ),
]);

errorCodeManifest.comments = [
  b.commentLine(' This file is meant to help with looking up the source of errors like', true),
  b.commentLine(' "Invariant Violation: 35" and is automatically generated by the file', true),
  b.commentLine(' @apollo/client/config/processInvariants.ts for each @apollo/client', true),
  b.commentLine(' release. The numbers may change from release to release, so please', true),
  b.commentLine(' consult the @apollo/client/invariantErrorCodes.js file specific to', true),
  b.commentLine(' your @apollo/client version. This file is not meant to be imported.', true),
];

function getErrorCode(
  file: string,
  expr: CallExpression | NewExpression,
): NumericLiteral {
  const numLit = b.numericLiteral(nextErrorCode++);
  errorCodeManifest.properties.push(
    b.property("init", numLit, b.objectExpression([
      b.property("init", b.identifier("file"), b.stringLiteral("@apollo/client/" + file)),
      b.property("init", b.identifier("node"), expr),
    ])),
  );
  return numLit;
}

function transform(code: string, file: string) {
  // If the code doesn't seem to contain anything invariant-related, we
  // can skip parsing and transforming it.
  if (!/invariant/i.test(code)) {
    return code;
  }

  const ast = reparse(code);

  recast.visit(ast, {
    visitCallExpression(path) {
      this.traverse(path);
      const node = path.node;

      if (isCallWithLength(node, "invariant", 1)) {
        if (isNodeEnvConditional(path.parent.node)) {
          return;
        }

        const newArgs = node.arguments.slice(0, 1);
        newArgs.push(getErrorCode(file, node));

        return b.conditionalExpression(
          makeNodeEnvTest(),
          b.callExpression.from({
            ...node,
            arguments: newArgs,
          }),
          node,
        );
      }

      if (node.callee.type === "MemberExpression" &&
          isIdWithName(node.callee.object, "invariant") &&
          isIdWithName(node.callee.property, "warn", "error")) {
        if (isNodeEnvLogicalOr(path.parent.node)) {
          return;
        }
        return b.logicalExpression("||", makeNodeEnvTest(), node);
      }
    },

    visitNewExpression(path) {
      this.traverse(path);
      const node = path.node;
      if (isCallWithLength(node, "InvariantError", 0)) {
        if (isNodeEnvConditional(path.parent.node)) {
          return;
        }

        const newArgs = [getErrorCode(file, node)];

        return b.conditionalExpression(
          makeNodeEnvTest(),
          b.newExpression.from({
            ...node,
            arguments: newArgs,
          }),
          node,
        );
      }
    }
  });

  return reprint(ast);
}

function isIdWithName(node: Node, ...names: string[]) {
  return n.Identifier.check(node) &&
    names.some(name => name === node.name);
}

function isCallWithLength(
  node: CallExpression | NewExpression,
  name: string,
  length: number,
) {
  return isIdWithName(node.callee, name) &&
    node.arguments.length > length;
}

function isNodeEnvConditional(node: Node) {
  return n.ConditionalExpression.check(node) &&
    isNodeEnvExpr(node.test);
}

function isNodeEnvLogicalOr(node: Node) {
  return n.LogicalExpression.check(node) &&
    node.operator === "||" &&
    isNodeEnvExpr(node.left);
}

function makeNodeEnvTest() {
  return b.binaryExpression(
    "===",
    b.memberExpression(
      b.memberExpression(
        b.identifier("process"),
        b.identifier("env")
      ),
      b.identifier("NODE_ENV"),
    ),
    b.stringLiteral("production"),
  );
}

const referenceNodeEnvExpr = makeNodeEnvTest();
function isNodeEnvExpr(node: Node) {
  return recast.types.astNodesAreEquivalent(node, referenceNodeEnvExpr);
}
