// 把界面要用的 three.js 文件拷到 src/renderer/vendor/three/，并把 `from 'three'`
// 改成相对路径（界面是 app:// 下的纯 ES 模块，没有打包器，也不用 importmap）。
// 升级 three 以后重新跑：node scripts/vendor-three.js
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'node_modules', 'three');
const OUT = path.join(__dirname, '..', 'src', 'renderer', 'vendor', 'three');
const FILES = [
  'build/three.module.js',
  'build/three.core.js',
  'examples/jsm/loaders/GLTFLoader.js',
  'examples/jsm/loaders/FBXLoader.js',
  'examples/jsm/curves/NURBSCurve.js',
  'examples/jsm/curves/NURBSUtils.js',
  'examples/jsm/utils/BufferGeometryUtils.js',
  'examples/jsm/utils/SkeletonUtils.js',
  'examples/jsm/libs/fflate.module.js',
  'examples/jsm/environments/RoomEnvironment.js',
  'LICENSE',
];

fs.rmSync(OUT, { recursive: true, force: true });
for (const rel of FILES) {
  const from = path.join(SRC, rel);
  const to = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  let text = fs.readFileSync(from, 'utf8');
  if (rel.endsWith('.js')) {
    const mod = path.relative(path.dirname(to), path.join(OUT, 'build', 'three.module.js')).split(path.sep).join('/');
    text = text.replace(/from\s+(['"])three\1/g, `from '${mod.startsWith('.') ? mod : './' + mod}'`);
  }
  fs.writeFileSync(to, text);
}
const unresolved = FILES.filter((f) => f.endsWith('.js')).flatMap((f) => {
  const text = fs.readFileSync(path.join(OUT, f), 'utf8');
  // 只看真正的 import / export 语句（注释里的示例代码不算）
  return [...text.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]/gm)]
    .map((m) => m[1])
    .filter((spec) => !fs.existsSync(path.resolve(path.join(OUT, path.dirname(f)), spec)))
    .map((spec) => `${f} → ${spec}`);
});
console.log(`three ${require(path.join(SRC, 'package.json')).version} → ${path.relative(process.cwd(), OUT)}`);
if (unresolved.length) {
  console.error('缺文件：\n' + unresolved.join('\n'));
  process.exit(1);
}
