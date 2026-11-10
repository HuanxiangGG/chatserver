import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const problems = [];
const dictionaries = { 'zh-CN': {}, en: {} };
function duplicates(node) {
 if (ts.isObjectLiteralExpression(node)) {
  const keys = new Set();
  for (const prop of node.properties) if (prop.name && ts.isStringLiteral(prop.name)) { if (keys.has(prop.name.text)) problems.push(`Duplicate translation key: ${prop.name.text}`); keys.add(prop.name.text); }
 }
 ts.forEachChild(node, duplicates);
}
for (const filename of fs.readdirSync('frontend/src/locales').filter(name => name.endsWith('.json') && name !== 'api-errors.json')) {
 const source = fs.readFileSync(path.join('frontend/src/locales', filename), 'utf8');
 const catalog = JSON.parse(source); duplicates(ts.parseJsonText(filename, source));
 for (const language of ['zh-CN', 'en']) for (const [key, value] of Object.entries(catalog[language] || {})) {
  if (Object.hasOwn(dictionaries[language], key)) problems.push(`Duplicate translation key across catalogs: ${key}`);
  dictionaries[language][key] = value;
 }
}
const zh = dictionaries['zh-CN'], en = dictionaries.en;
const used = new Set();
const apiKeys = JSON.parse(fs.readFileSync('frontend/src/locales/api-errors.json', 'utf8'));
for (const key of Object.values(apiKeys)) { used.add(key); if (!en[key]) problems.push(`Invalid API translation key: ${key}`); }
const variables = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
for (const key of new Set([...Object.keys(zh), ...Object.keys(en)])) {
 if (!zh[key] || !en[key]) problems.push(`Missing translation: ${key}`);
 else if (variables(zh[key]) !== variables(en[key])) problems.push(`Interpolation mismatch: ${key}`);
}
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []); }
// Include every screen and helper; no legacy exclusions.
for (const file of files('frontend/src')) {
 const text = fs.readFileSync(file, 'utf8'), ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
 let count = 0;
 const visibleAttributes = /^(title|placeholder|alt|aria-label|aria-description|aria-valuetext|aria-roledescription|label|heading|description|message|helperText|emptyText|confirmText|cancelText)$/;
 const visibleText = value => /[a-zA-Z\u3400-\u9fff]/u.test(value);
 // Follow only values rendered as text. Conditions, event handlers, CSS classes,
 // API enums and translation arguments are not user-facing strings themselves.
 function renderedExpression(node) {
  if (!node) return;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) { if (visibleText(node.text)) count++; return; }
  if (ts.isTemplateExpression(node)) {
   if (visibleText(node.head.text) || node.templateSpans.some(span => visibleText(span.literal.text))) count++;
   node.templateSpans.forEach(span => renderedExpression(span.expression)); return;
  }
  if (ts.isConditionalExpression(node)) { renderedExpression(node.whenTrue); renderedExpression(node.whenFalse); return; }
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(node.operatorToken.kind)) {
   if (node.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) renderedExpression(node.left);
   renderedExpression(node.right); return;
  }
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isNonNullExpression(node) || ts.isSatisfiesExpression(node)) { renderedExpression(node.expression); return; }
  if (ts.isArrayLiteralExpression(node)) node.elements.forEach(renderedExpression);
 }
 function visit(n) {
  if (ts.isStringLiteral(n) && Object.hasOwn(en, n.text)) used.add(n.text);
  if (ts.isCallExpression(n) && ['t', 'tr', 'translate'].includes(n.expression.getText(ast)) && n.arguments[0]) {
   const checkKey = value => {
    if (ts.isStringLiteral(value) && !Object.hasOwn(en, value.text)) problems.push(`${file}: invalid translation key ${value.text}`);
    if (ts.isConditionalExpression(value)) { checkKey(value.whenTrue); checkKey(value.whenFalse); }
   };
   checkKey(n.arguments[0]);
  }

  if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && /[\u3400-\u9fff]/u.test(n.text)) count++;
  if (ts.isJsxText(n) && /[a-zA-Z\u3400-\u9fff]/u.test(n.text.trim())) count++;
  if (ts.isJsxAttribute(n) && visibleAttributes.test(n.name.getText(ast)) && n.initializer) {
   if (ts.isStringLiteral(n.initializer) && visibleText(n.initializer.text)) count++;
   else if (ts.isJsxExpression(n.initializer)) renderedExpression(n.initializer.expression);
  }
  if (ts.isJsxExpression(n) && !ts.isJsxAttribute(n.parent)) renderedExpression(n.expression);
  ts.forEachChild(n, visit);
 }
 visit(ast); if (count) problems.push(`${file}: ${count} untranslated text occurrences`);
}
for (const key of Object.keys(en)) if (!used.has(key)) problems.push(`Unused translation key: ${key}`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('Translation dictionaries and UI text checks passed.');
