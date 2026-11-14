#!/usr/bin/env node
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

function refuse(line, reason) {
  throw new Error(`line ${line + 1}: ${reason}`);
}

function scalar(value) {
  const match = /^(?:"([^"\\]*)"|'([^']*)'|([^\s#'"{}\[\],&*!|>]+))([ \t]*)(#.*)?$/.exec(value);
  if (!match) return null;
  return { ref: match[1] ?? match[2] ?? match[3], quote: match[1] !== undefined ? '"' : match[2] !== undefined ? "'" : "", space: match[4], comment: match[5] };
}

export function validatePins(pins) {
  if (!pins || typeof pins !== "object" || Array.isArray(pins)) throw new Error("pins must be a JSON object");
  for (const [ref, replacement] of Object.entries(pins)) {
    const target = typeof replacement === "string" ? scalar(replacement) : null;
    if (!/^[\w.-]+\/[\w./-]+@[^\s#]+$/.test(ref) || /@[0-9a-f]{40}$/i.test(ref) ||
        !target || target.quote || !/@[0-9a-f]{40}$/i.test(target.ref) || ref.split("@")[0] !== target.ref.split("@")[0]) {
      throw new Error(`invalid pin: ${ref} (expected the same action at a full 40-hex SHA)`);
    }
  }
}

// Recognize block mappings and sequences only. This is a text editor, not a YAML parser:
// opaque layouts are retained, and a target inside one is refused rather than guessed at.
// The quote that opens a quoted scalar without closing it on the same line (its body continues on the next lines),
// or null. A double-quoted scalar escapes with backslashes; a single-quoted one doubles the quote.
function unterminatedQuote(value) {
  const quote = value[0];
  if (quote !== '"' && quote !== "'") return null;
  return quoteEnd(value, 1, quote) === -1 ? quote : null;
}

function quoteEnd(text, from, quote) {
  for (let index = from; index < text.length; index++) {
    if (quote === '"' && text[index] === "\\") index++;
    else if (text[index] === quote && quote === "'" && text[index + 1] === "'") index++;
    else if (text[index] === quote) return index;
  }
  return -1;
}

// Values this editor can't delimit, so the lines after them can't be told apart from structure: an anchor or tag before
// a value (its scalar may continue on the next lines), and a flow collection that doesn't close on its line. A file with
// one is refused before anything is written, rather than risk editing text inside a string.
function unsupportedOpener(value) {
  if (/^[&!]/.test(value)) return "anchors and tags before a value are unsupported";
  if (/^[{[]/.test(value) && !flowClosesOnLine(value)) return "flow collections spanning lines are unsupported";
  return null;
}

function flowClosesOnLine(value) {
  let depth = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '"' || char === "'") {
      index = quoteEnd(value, index + 1, char);
      if (index === -1) return false;
    } else if (char === "#" && /\s/.test(value[index - 1] ?? " ")) {
      break;
    } else if (char === "{" || char === "[") {
      depth++;
    } else if (char === "}" || char === "]") {
      depth--;
    }
  }
  return depth === 0;
}

const BLOCK_SCALAR_HEADER = /^[|>](?:[1-9][+-]?|[+-][1-9]?)?[ \t]*(?:#.*)?$/;

function scan(lines) {
  const stack = [];
  const nodes = [];
  const opaque = [];
  let blockIndent = null;
  let openQuote = null;
  for (let index = 0; index < lines.length; index++) {
    const text = lines[index].text;
    // Inside a quoted scalar that spans lines: its body is string content, never YAML structure, and is left as is.
    if (openQuote) {
      if (quoteEnd(text, 0, openQuote) !== -1) openQuote = null;
      continue;
    }
    if (!text.trim() || /^\s*#/.test(text)) continue;
    const indent = text.match(/^ */)[0].length;
    if (blockIndent !== null && indent > blockIndent) continue;
    blockIndent = null;
    if (/^ *\t/.test(text)) refuse(index, "tab indentation is unsupported");
    const item = /^( *)- +/.exec(text);
    let body = text.slice(indent);
    let keyIndent = indent;
    if (item) {
      while (stack.length && (stack.at(-1).indent > indent || (stack.at(-1).indent === indent && stack.at(-1).sequence))) stack.pop();
      const node = { line: index, indent, parent: stack.at(-1), children: [], sequence: true };
      node.parent?.children.push(node);
      nodes.push(node);
      stack.push(node);
      keyIndent = item[0].length;
      body = text.slice(keyIndent);
    } else {
      while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    }
    if (/^("[\w-]+"|'[\w-]+'|[\w-]+|<<):[ ]*\t/.test(body)) refuse(index, "a tab before a value is unsupported");
    // `run :` is a valid key too; unrecognized, its block's lines would be read as structure.
    if (/^("[\w-]+"|'[\w-]+'|[\w-]+|<<)[ \t]+:(?:[ \t]|$)/.test(body)) refuse(index, "space before ':' is unsupported");
    const mapping = /^("[\w-]+"|'[\w-]+'|[\w-]+|<<):(?: +(.*))?$/.exec(body);
    if (!mapping) {
      if (item) {
        const opener = unsupportedOpener(body) ?? (unterminatedQuote(body) ? "quoted scalars spanning lines in a sequence are unsupported" : null);
        if (opener) refuse(index, opener);
      }
      opaque.push({ line: index, parent: stack.at(-1), text });
      if (item && BLOCK_SCALAR_HEADER.test(body)) blockIndent = indent;
      continue;
    }
    const key = mapping[1].replace(/^['"]|['"]$/g, "");
    const value = mapping[2] ?? "";
    const opener = unsupportedOpener(value);
    if (opener) refuse(index, opener);
    const node = { key, value, line: index, indent: keyIndent, parent: stack.at(-1), children: [] };
    node.parent?.children.push(node);
    nodes.push(node);
    if (!value || value.startsWith("#")) stack.push(node);
    if (BLOCK_SCALAR_HEADER.test(value)) blockIndent = keyIndent;
    openQuote = unterminatedQuote(value);
  }
  return { nodes, opaque };
}

function isJob(node) {
  return node?.parent?.key === "jobs" && !node.parent.parent;
}

function isStep(node) {
  return node?.sequence && node.parent?.key === "steps" && isJob(node.parent.parent);
}

function isWithin(node, ancestor) {
  for (let current = node; current; current = current.parent) if (current === ancestor) return true;
  return false;
}

function checkoutInsertion(uses, opaque) {
  const step = uses.parent;
  if (!isStep(step)) refuse(uses.line, "checkout is not in a supported block step");
  if (opaque.some((entry) => isWithin(entry.parent, step))) refuse(uses.line, "unsupported checkout step layout");
  const keys = step.children;
  if (keys.some((key) => key.sequence || key.indent !== uses.indent || key.key === "<<") ||
      new Set(keys.map((key) => key.key)).size !== keys.length) refuse(uses.line, "ambiguous checkout step keys");
  const withNode = keys.find((key) => key.key === "with");
  if (!withNode) return { after: uses.line, text: `${" ".repeat(uses.indent)}with:\n${" ".repeat(uses.indent + 2)}persist-credentials: false` };
  if (withNode.children.some((key) => key.key === "persist-credentials") || /\bpersist-credentials\s*:/.test(withNode.value)) {
    refuse(uses.line, "checkout already sets persist-credentials");
  }
  if (withNode.value && !withNode.value.startsWith("#")) refuse(withNode.line, "checkout with: must be a block mapping");
  const inputIndent = withNode.children[0]?.indent ?? uses.indent + 2;
  if (withNode.children.some((key) => key.sequence || key.indent !== inputIndent || key.key === "<<")) {
    refuse(withNode.line, "ambiguous checkout inputs");
  }
  return { after: withNode.line, text: `${" ".repeat(inputIndent)}persist-credentials: false` };
}

export function harden(original, pins) {
  validatePins(pins);
  const lines = [...original.matchAll(/([^\r\n]*)(\r\n|\n|\r|$)/g)]
    .filter((match) => match[0]).map((match) => ({ text: match[1], eol: match[2] }));
  const { nodes, opaque } = scan(lines);
  const targets = ["actions/checkout@", ...Object.keys(pins)];
  for (const entry of opaque) {
    if (targets.some((ref) => entry.text.includes(ref))) refuse(entry.line, "unsupported uses/step layout");
  }
  const insertions = new Map();
  for (const node of nodes) {
    if (node.key !== "uses" && /^[\[{]/.test(node.value) && targets.some((ref) => node.value.includes(ref))) {
      refuse(node.line, "unsupported flow layout containing a target ref");
    }
    if (node.key !== "uses") continue;
    const value = scalar(node.value);
    if (!value) refuse(node.line, "unsupported uses scalar");
    const checkout = value.ref.startsWith("actions/checkout@");
    const replacement = Object.hasOwn(pins, value.ref) ? scalar(pins[value.ref]) : null;
    if (!checkout && !replacement) continue;
    if (!isStep(node.parent) && !isJob(node.parent)) refuse(node.line, "uses is outside a supported job or step");
    if (replacement) {
      if (value.comment) refuse(node.line, "refusing to replace a commented tag pin");
      const prefix = lines[node.line].text.slice(0, lines[node.line].text.indexOf(":") + 1);
      const spacing = lines[node.line].text.slice(prefix.length).match(/^ */)[0];
      lines[node.line].text = `${prefix}${spacing}${value.quote}${replacement.ref}${value.quote}${replacement.comment ? ` ${replacement.comment}` : ""}${value.space}`;
    }
    if (checkout) {
      const insertion = checkoutInsertion(node, opaque);
      insertions.set(insertion.after, insertion.text);
    }
  }
  const eol = lines.find((line) => line.eol)?.eol ?? "\n";
  return lines.map((line, index) => {
    const insertion = insertions.get(index);
    if (!insertion) return line.text + line.eol;
    return line.text + (line.eol || eol) + insertion.replaceAll("\n", line.eol || eol) + line.eol;
  }).join("");
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2);
  if (args[0] !== "--pins" || args.length < 3) {
    console.error("usage: harden.mjs --pins <pins.json> <workflow>...");
    process.exitCode = 1;
  } else {
    try {
      const pins = JSON.parse(readFileSync(args[1], "utf8"));
      validatePins(pins);
      for (const path of args.slice(2)) {
        try {
          const original = readFileSync(path, "utf8");
          const result = harden(original, pins);
          if (result !== original) {
            writeFileSync(path, result);
            console.log(`changed ${path}`);
          }
        } catch (error) {
          throw new Error(`${path}: ${error.message}`, { cause: error });
        }
      }
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}
