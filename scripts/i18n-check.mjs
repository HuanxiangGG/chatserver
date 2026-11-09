import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
const problems = [];
const source = fs.readFileSync('frontend/src/locales/sound.json', 'utf8');
const dictionaries = JSON.parse(source);
const json = ts.parseJsonText('sound.json', source);
function duplicates(node) {
 if (ts.isObjectLiteralExpression(node)) {
  const keys = new Set();
  for (const prop of node.properties) if (prop.name && ts.isStringLiteral(prop.name)) { if (keys.has(prop.name.text)) problems.push(`Duplicate translation key: ${prop.name.text}`); keys.add(prop.name.text); }
 }
 ts.forEachChild(node, duplicates);
}
duplicates(json);
const zh = dictionaries['zh-CN'], en = dictionaries.en;
const variables = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
for (const key of new Set([...Object.keys(zh), ...Object.keys(en)])) {
 if (!zh[key] || !en[key]) problems.push(`Missing translation: ${key}`);
 else if (variables(zh[key]) !== variables(en[key])) problems.push(`Interpolation mismatch: ${key}`);
}
function files(dir) { return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(path.join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(dir, e.name)] : []); }
// Deliberately include existing screens: this gate must not conceal the unfinished full-site migration.
for (const file of files('frontend/src')) {
 const text = fs.readFileSync(file, 'utf8'), ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
 let count = 0;
 function visit(n) {
  if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) && /[\u3400-\u9fff]/u.test(n.text)) count++;
  if (ts.isJsxText(n) && /[a-zA-Z\u3400-\u9fff]/u.test(n.text.trim())) count++;
  if (ts.isJsxAttribute(n) && /^(title|placeholder|alt|aria-label)$/.test(n.name.getText(ast)) && n.initializer && ts.isStringLiteral(n.initializer) && /[a-zA-Z]/.test(n.initializer.text)) count++;
  ts.forEachChild(n, visit);
 }
 visit(ast); if (count) problems.push(`${file}: ${count} untranslated text occurrences`);
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('Translation dictionaries and UI text checks passed.');
