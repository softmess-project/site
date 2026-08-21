#!/usr/bin/env node
// Turns eslint's JSON output into SARIF 2.1.0, the only format GitHub code
// scanning ingests. Hand-rolled rather than pulled in: the usual choice,
// @microsoft/eslint-formatter-sarif, depends on a second (deprecated) eslint 8,
// on lodash, and on `jschardet: "latest"` — a floating range in a repo that
// pins overrides by parent — which is a lot of supply chain for the ~40 lines
// the shape actually needs.
//
// Paths come out relative to the repo root with uriBaseId %SRCROOT%, which is
// what lets GitHub map a result onto a line of the diff. So run this from the
// root, not from a package.
import {readFileSync} from 'node:fs'
import {relative} from 'node:path'

const LEVELS = {1: 'warning', 2: 'error'}

const inputs = process.argv.slice(2)
if (inputs.length === 0) {
  console.error('usage: node scripts/eslint-sarif.mjs <eslint-json>… > out.sarif')
  process.exit(2)
}

const rules = new Map()
const results = []

for (const input of inputs) {
  for (const {filePath, messages} of JSON.parse(readFileSync(input, 'utf8'))) {
    for (const message of messages) {
      // `fatal` is a parse or config failure rather than a finding. Uploading
      // zero results for a broken config would read as a clean run, so say so
      // and fail instead.
      if (message.fatal) {
        console.error(`${filePath}: ${message.message}`)
        process.exit(1)
      }

      // Everything else without a ruleId is advisory output with no rule to
      // group an alert under.
      if (!message.ruleId) continue

      const level = LEVELS[message.severity] ?? 'note'
      if (!rules.has(message.ruleId)) {
        rules.set(message.ruleId, {id: message.ruleId, defaultConfiguration: {level}})
      }

      results.push({
        ruleId: message.ruleId,
        level,
        message: {text: message.message},
        locations: [
          {
            physicalLocation: {
              artifactLocation: {uri: relative(process.cwd(), filePath), uriBaseId: '%SRCROOT%'},
              region: {
                startLine: message.line ?? 1,
                startColumn: message.column ?? 1,
                endLine: message.endLine ?? message.line ?? 1,
                endColumn: message.endColumn ?? message.column ?? 1,
              },
            },
          },
        ],
      })
    }
  }
}

const sarif = {
  $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
  version: '2.1.0',
  runs: [
    {
      tool: {
        driver: {
          name: 'ESLint',
          informationUri: 'https://eslint.org',
          rules: [...rules.values()],
        },
      },
      results,
    },
  ],
}

process.stdout.write(`${JSON.stringify(sarif, null, 2)}\n`)
