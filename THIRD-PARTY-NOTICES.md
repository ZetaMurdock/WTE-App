# Third-party notices

W.T.E bundles the open-source components below. Each is used under its own
license; the copyright notices here satisfy their attribution requirements.
This file must accompany any distribution of W.T.E.

## Runtime components (shipped in the application)

| Component | License |
| --- | --- |
| [Tauri](https://tauri.app) (framework + `plugin-sql`, `plugin-updater`, `plugin-dialog`, `plugin-fs`, `plugin-process`) | MIT OR Apache-2.0 |
| [PixiJS](https://pixijs.com) | MIT |
| [React](https://react.dev) and React DOM | MIT |
| [three.js](https://threejs.org) | MIT |
| [Firebase JavaScript SDK](https://firebase.google.com/docs/web/setup) (loaded at runtime from `gstatic.com`) | Apache-2.0 |
| Rust crates in `src-tauri/Cargo.toml` (incl. `serde`, `zip`, `open`, `tokio`) | MIT OR Apache-2.0 |

## Build-time only (not shipped)

TypeScript (Apache-2.0), Vite (MIT), Vitest (MIT), `@vitejs/plugin-react` (MIT),
`@tauri-apps/cli` (MIT OR Apache-2.0), and the `@types/*` definition packages (MIT).

---

## MIT License

Applies to PixiJS, React, React DOM, three.js, Vite, Vitest, and the MIT-licensed
Tauri components and Rust crates listed above. Copyright belongs to the
respective authors of each project.

```
Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Apache License 2.0

Applies to the Firebase JavaScript SDK, TypeScript, and the Apache-2.0-licensed
Tauri components and Rust crates listed above.

The full license text is available at <https://www.apache.org/licenses/LICENSE-2.0>.

```
Licensed under the Apache License, Version 2.0 (the "License");
you may not use these files except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```
