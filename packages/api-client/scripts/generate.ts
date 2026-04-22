import openapiTS, { astToString } from "openapi-typescript";

const url = process.env.API_URL ?? "http://localhost:3000/openapi.json";
const ast = await openapiTS(new URL(url));
const code = astToString(ast);
await Bun.write("src/schema.ts", code);
console.log(`generated src/schema.ts from ${url}`);
