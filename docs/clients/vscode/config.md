# Стек и конфигурация — VS Code Extension

## Технологический стек

| Категория | Технология |
|---|---|
| Язык | TypeScript |
| VS Code API | 1.85+ |
| Сборка | Webpack |
| HTTP | стандартный `http`/`https` (без axios — чтобы не тащить deps) |
| Локальный парсер | `web-tree-sitter` + скомпилированный `tree-sitter-c.wasm` |
| Auth | `vscode.authentication.getSession('github' | 'microsoft', ...)` |
| Хранение токена | `context.secrets` (encrypted) |
| Линтер | ESLint |

## package.json — основные поля

```json
{
  "engines": { "vscode": "^1.85.0" },
  "categories": ["Programming Languages", "Linters", "Visualization"],
  "activationEvents": ["onLanguage:c"],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      { "command": "analyzer.login",          "title": "Analyzer: Login" },
      { "command": "analyzer.logout",         "title": "Analyzer: Logout" },
      { "command": "analyzer.runAnalysis",    "title": "Analyzer: Run Analysis" },
      { "command": "analyzer.localAnalysis",  "title": "Analyzer: Run Local Analysis (Tree-sitter)" },
      { "command": "analyzer.showReport",     "title": "Analyzer: Show Report Panel" },
      { "command": "analyzer.clearDecorations", "title": "Analyzer: Clear Decorations" }
    ],
    "configuration": {
      "title": "Cache & Memory Analyzer",
      "properties": {
        "analyzer.apiUrl":              { "type": "string",  "default": "http://localhost:80/api/v1" },
        "analyzer.pollingIntervalMs":   { "type": "number",  "default": 2500 },
        "analyzer.autoLocalAnalysis":   { "type": "boolean", "default": true },
        "analyzer.showInlineHints":     { "type": "boolean", "default": true },
        "analyzer.severityThreshold":   { "type": "string",  "enum": ["info","warning","error"], "default": "warning" }
      }
    }
  }
}
```

::: info `activationEvents: onLanguage:c`
Расширение активируется только при открытии `.c` файла. Без этого VS Code загружал бы extension host лишний раз для всех типов файлов.
:::

## Сборка через webpack

```js
// webpack.config.js (упрощённо)
module.exports = {
  target: 'node',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },
  externals: {
    vscode: 'commonjs vscode',         // не бандлим VS Code API
    'web-tree-sitter': 'commonjs web-tree-sitter',
  },
  resolve: { extensions: ['.ts', '.js'] },
  module: { rules: [{ test: /\.ts$/, use: 'ts-loader' }] },
}
```

::: tip Почему webpack, а не esbuild
- `web-tree-sitter` загружается через CommonJS `require()` динамически — webpack лучше справляется с этим, чем esbuild.
- `target: 'node'` важен — Extension Host работает в Node-runtime, не в браузере.
:::

## tree-sitter-c.wasm

```bash
# создаётся командой
tree-sitter generate
emcc -O3 -o tree-sitter-c.wasm src/parser.c ...
```

В нашем репозитории WASM-файл уже включён как `tree-sitter-c.wasm` в корень расширения и копируется в `dist/` при сборке.

```js
await Parser.init({
  locateFile: (file) => path.join(distDir, file),
})
```

::: tip Почему предкомпилированный WASM
Сборка `tree-sitter-c` из исходников требует Emscripten, что усложняет CI. Готовый `.wasm` (~600KB) идёт в комплекте с расширением.
:::

## Хранение токена

```ts
// src/api/client.ts
async loadToken(): Promise<void> {
    this.token = await this.context.secrets.get('analyzer_token')
    this.userEmail = this.context.globalState.get<string>('analyzer_email')
}

async saveToken(token: string, email: string): Promise<void> {
    await this.context.secrets.store('analyzer_token', token)
    await this.context.globalState.update('analyzer_email', email)
}
```

::: tip Почему `context.secrets`, а не `globalState`
- `secrets` шифруется через системный keychain (macOS Keychain, Windows Credential Manager, libsecret на Linux).
- Никаких токенов в plain-text-конфигах.
- `globalState` подходит только для непривилегированных данных (как user email — в нём нет ничего секретного).
:::

## Команды разработки

```bash
# в каталоге diploma-vscode
npm install
npm run watch          # webpack --watch
# F5 в VS Code → "Run Extension" launches new VSC window
```

## Webpack output

```
dist/
├── extension.js              # бандл
├── tree-sitter.js (loader)
├── tree-sitter.wasm
└── tree-sitter-c.wasm
```

При публикации в Marketplace `.vscodeignore` исключает `node_modules`, `src`, `webpack.config.js`.
