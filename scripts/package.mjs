#!/usr/bin/env node
/**
 * Fabrique les installeurs : un .deb (Debian/Ubuntu amd64) et un .exe (Windows x64).
 *
 *   node scripts/package.mjs [--version 1.2.3] [--target deb|win|all]
 *
 * Même contenu des deux côtés : Node, le lanceur (solocast.mjs), le site exporté (web/), le SFU
 * LiveKit et cloudflared. Les binaires amont sont épinglés par version ET par SHA-256.
 * Nécessite : pnpm, tar, unzip (ou 7z), dpkg-deb (cible deb), makensis (cible win).
 */
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache", "downloads");
const OUT = path.join(ROOT, "dist", "release");
const STAGE = path.join(ROOT, "dist", "stage");

const NODE_VERSION = "22.23.3";
const LIVEKIT_VERSION = "1.13.9";
const CLOUDFLARED_VERSION = "2026.10.0";

const UPSTREAM = {
  linux: {
    node: {
      url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-x64.tar.xz`,
      sha256: "df450af89261115ef9f9e3830c3eeb2cc9213b63c720b1af623cb5dcbe2e02de",
    },
    livekit: {
      url: `https://github.com/livekit/livekit/releases/download/v${LIVEKIT_VERSION}/livekit_${LIVEKIT_VERSION}_linux_amd64.tar.gz`,
      sha256: "0b7fa208b662d09cfdeae8c06cf4c481aead0556086558b48250501e2e2d6e20",
    },
    cloudflared: {
      url: `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-linux-amd64`,
      sha256: "d33ff2d14475178d2012c2c56beba87389ac5ded27649519f198a7d3134a99db",
    },
  },
  win: {
    node: {
      url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`,
      sha256: "2b0ff57b049cda1bbcea2240eec20467018713c1efe1f7360c2681859b90ed71",
    },
    livekit: {
      url: `https://github.com/livekit/livekit/releases/download/v${LIVEKIT_VERSION}/livekit_${LIVEKIT_VERSION}_windows_amd64.zip`,
      sha256: "d5b5e44c197f613fdd6bdb2ae53e9d086d848156d43f614c688c6b595cd3f25e",
    },
    cloudflared: {
      url: `https://github.com/cloudflare/cloudflared/releases/download/${CLOUDFLARED_VERSION}/cloudflared-windows-amd64.exe`,
      sha256: "86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c",
    },
  },
};
const CLOUDFLARED_LICENSE = {
  url: `https://raw.githubusercontent.com/cloudflare/cloudflared/${CLOUDFLARED_VERSION}/LICENSE`,
  sha256: "58d1e17ffe5109a7ae296caafcadfdbe6a7d176f0bc4ab01e12a689b0499d8bd",
};

const MAINTAINER = "kerstz <167791613+kerstz@users.noreply.github.com>";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`--${name} attend une valeur`);
  return value;
}

const version =
  arg("version", undefined) ??
  JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const target = arg("target", "all");
if (!["deb", "win", "all"].includes(target))
  throw new Error("--target doit valoir deb, win ou all");
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z]+(\.[0-9A-Za-z]+)*)?$/.test(version)) {
  throw new Error(`Version invalide : ${version} (attendu x.y.z ou x.y.z-rc.1)`);
}
// Debian : « 0.1.0-rc1 » serait lu comme une révision postérieure à 0.1.0 ; « ~ » trie avant.
const debVersion = version.replace("-", "~");
// VIProductVersion (Windows) exige quatre nombres.
const version4 = `${version.match(/^\d+\.\d+\.\d+/)[0]}.0`;

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: "inherit", ...options });
const has = (cmd, probe = ["--version"]) => {
  try {
    execFileSync(cmd, probe, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

// Date fixe des fichiers : le .deb ne dépend plus de l'heure du build.
const SOURCE_DATE_EPOCH = Number(
  process.env.SOURCE_DATE_EPOCH ??
    execFileSync("git", ["log", "-1", "--format=%ct"], { cwd: ROOT, encoding: "utf8" }).trim(),
);

const sha256Of = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");

async function download({ url, sha256 }, attempts = 4) {
  mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `${sha256.slice(0, 12)}-${path.basename(url)}`);
  if (existsSync(file) && sha256Of(file) === sha256) return file;
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      console.log(`  télécharge ${url}${attempt > 1 ? ` (essai ${String(attempt)})` : ""}`);
      const response = await fetch(url, {
        redirect: "follow",
        signal: AbortSignal.timeout(300_000),
      });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      const part = `${file}.part`;
      writeFileSync(part, Buffer.from(await response.arrayBuffer()));
      if (sha256Of(part) !== sha256) {
        rmSync(part);
        throw new Error("SHA-256 inattendu");
      }
      renameSync(part, file);
      return file;
    } catch (error) {
      lastError = error;
      if (error instanceof Error && error.message === "SHA-256 inattendu") break;
      await new Promise((resolve) => setTimeout(resolve, 2_000 * attempt));
    }
  }
  throw new Error(`${url} : ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function unzipMember(zip, pattern, destDir) {
  mkdirSync(destDir, { recursive: true });
  if (has("unzip", ["-v"])) run("unzip", ["-q", "-j", "-o", zip, pattern, "-d", destDir]);
  else run("7z", ["e", "-y", `-o${destDir}`, zip, pattern]);
}

/** Texte de licence d'un paquet npm : LICENSE / LICENCE / COPYING dans son dossier. */
function licenseTextOf(dir) {
  for (const name of readdirSync(dir)) {
    if (/^(licen[sc]e|copying)(\.(md|txt))?$/i.test(name)) {
      return readFileSync(path.join(dir, name), "utf8").trim();
    }
  }
  return "";
}

/** Racine du paquet npm qui contient `file` (…/node_modules/<nom> ou …/node_modules/@scope/<nom>). */
function packageRootOf(file) {
  const marker = `${path.sep}node_modules${path.sep}`;
  const index = file.lastIndexOf(marker);
  if (index === -1) return null;
  const rest = file.slice(index + marker.length).split(path.sep);
  const length = rest[0].startsWith("@") ? 2 : 1;
  return path.join(file.slice(0, index + marker.length), ...rest.slice(0, length));
}

/**
 * THIRD_PARTY.txt : chaque paquet npm réellement embarqué (bundle du lanceur d'après le metafile
 * d'esbuild, plus les dépendances directes du site) avec sa licence. Les avis MIT/ISC/Apache
 * exigent d'être redistribués avec le code.
 */
function thirdPartyNotices() {
  const roots = new Set();
  const meta = JSON.parse(readFileSync(path.join(ROOT, "apps/backend/dist/meta.json"), "utf8"));
  for (const input of Object.keys(meta.inputs)) {
    const root = packageRootOf(path.resolve(ROOT, "apps/backend", input));
    if (root !== null) roots.add(root);
  }
  const webPackage = JSON.parse(readFileSync(path.join(ROOT, "apps/web/package.json"), "utf8"));
  for (const name of Object.keys(webPackage.dependencies ?? {})) {
    if (name.startsWith("@solocast/")) continue;
    const dir = path.join(ROOT, "apps/web/node_modules", name);
    if (existsSync(dir)) roots.add(path.resolve(dir));
  }

  const entries = [];
  for (const root of roots) {
    const manifestFile = path.join(root, "package.json");
    if (!existsSync(manifestFile)) continue;
    const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
    if (manifest.name === undefined || manifest.name.startsWith("@solocast/")) continue;
    const license =
      typeof manifest.license === "string"
        ? manifest.license
        : (manifest.license?.type ?? "voir le texte");
    entries.push({
      name: `${manifest.name}@${manifest.version}`,
      license,
      text: licenseTextOf(root),
    });
  }
  const unique = [...new Map(entries.map((e) => [e.name, e])).values()];
  unique.sort((a, b) => a.name.localeCompare(b.name));
  entries.length = 0;
  entries.push(...unique);

  const header = [
    "SoloCast embarque les programmes et bibliothèques suivants, sous leurs licences d'origine.",
    "",
    `- Node.js ${NODE_VERSION} (MIT)            licenses/node-LICENSE`,
    `- LiveKit server ${LIVEKIT_VERSION} (Apache-2.0)  licenses/livekit-LICENSE`,
    `- cloudflared ${CLOUDFLARED_VERSION} (Apache-2.0)  licenses/cloudflared-LICENSE`,
    "- Polices Press Start 2P et VT323 (OFL-1.1)   licenses/OFL-*.txt",
    "",
    "Paquets npm embarqués :",
    "",
  ];
  const body = entries.map(
    (e) =>
      `${"=".repeat(78)}\n${e.name}  —  ${e.license}\n${"=".repeat(78)}\n${e.text === "" ? "(pas de fichier de licence dans le paquet)" : e.text}\n`,
  );
  return `${header.join("\n")}${entries.map((e) => `- ${e.name} (${e.license})`).join("\n")}\n\n${body.join("\n")}`;
}

async function stageFor(os) {
  const dir = path.join(STAGE, os);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const ext = os === "win" ? ".exe" : "";
  const up = UPSTREAM[os];
  const licenseDir = path.join(dir, "licenses");
  mkdirSync(licenseDir, { recursive: true });
  const tmp = path.join(STAGE, `${os}-tmp`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });

  // Node : l'exécutable et sa licence.
  const nodeFile = await download(up.node);
  if (os === "win") {
    unzipMember(nodeFile, "node-*/node.exe", dir);
    unzipMember(nodeFile, "node-*/LICENSE", tmp);
  } else {
    run("tar", [
      "-xJf",
      nodeFile,
      "-C",
      dir,
      "--strip-components=2",
      "--wildcards",
      "node-*/bin/node",
    ]);
    run("tar", [
      "-xJf",
      nodeFile,
      "-C",
      tmp,
      "--strip-components=1",
      "--wildcards",
      "node-*/LICENSE",
    ]);
  }
  copyFileSync(path.join(tmp, "LICENSE"), path.join(licenseDir, "node-LICENSE"));

  // LiveKit : le serveur et sa licence.
  const livekitFile = await download(up.livekit);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  if (os === "win") {
    unzipMember(livekitFile, "livekit-server.exe", dir);
    unzipMember(livekitFile, "LICENSE", tmp);
  } else {
    run("tar", ["-xzf", livekitFile, "-C", dir, "livekit-server"]);
    run("tar", ["-xzf", livekitFile, "-C", tmp, "LICENSE"]);
  }
  copyFileSync(path.join(tmp, "LICENSE"), path.join(licenseDir, "livekit-LICENSE"));
  rmSync(tmp, { recursive: true, force: true });

  // cloudflared et sa licence (texte épinglé par hash).
  copyFileSync(await download(up.cloudflared), path.join(dir, `cloudflared${ext}`));
  copyFileSync(await download(CLOUDFLARED_LICENSE), path.join(licenseDir, "cloudflared-LICENSE"));

  // Polices du site (OFL exige de redistribuer la licence avec elles).
  for (const name of ["OFL-PressStart2P.txt", "OFL-VT323.txt"]) {
    copyFileSync(path.join(ROOT, "packaging/licenses", name), path.join(licenseDir, name));
  }

  copyFileSync(path.join(ROOT, "apps/backend/dist/solocast.mjs"), path.join(dir, "solocast.mjs"));
  cpSync(path.join(ROOT, "apps/web/out"), path.join(dir, "web"), { recursive: true });
  writeFileSync(path.join(dir, "THIRD_PARTY.txt"), thirdPartyNotices());

  if (os === "win") {
    copyFileSync(path.join(ROOT, "packaging/win/solocast.ico"), path.join(dir, "solocast.ico"));
    buildLauncher(path.join(dir, "SoloCast.exe"));
  } else {
    copyFileSync(path.join(ROOT, "apps/web/app/icon.svg"), path.join(dir, "solocast.svg"));
  }
  for (const name of ["node", "livekit-server", "cloudflared"]) {
    const file = path.join(dir, `${name}${ext}`);
    if (existsSync(file)) chmodSync(file, 0o755);
  }
  return dir;
}

function dirSizeKb(dir) {
  let bytes = 0;
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else bytes += statSync(full).size;
    }
  };
  walk(dir);
  return Math.ceil(bytes / 1024);
}

/** Tous les fichiers d'un arbre, chemins relatifs, ordre stable. */
function listFiles(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

function stampTree(dir) {
  const when = new Date(SOURCE_DATE_EPOCH * 1000);
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      utimesSync(full, when, when);
    }
  };
  walk(dir);
  utimesSync(dir, when, when);
}

// --dry-run : construit et laisse l'arbre du paquet (dist/stage/deb-tree) sans appeler dpkg-deb.
const dryRun = process.argv.includes("--dry-run");

function buildDeb(staged) {
  if (!dryRun && !has("dpkg-deb")) {
    throw new Error("dpkg-deb introuvable (apt install dpkg / pacman -S dpkg)");
  }
  const tree = path.join(STAGE, "deb-tree");
  rmSync(tree, { recursive: true, force: true });
  const opt = path.join(tree, "opt/solocast");
  cpSync(staged, opt, { recursive: true });
  // Le script de licences Windows n'a pas de sens ici ; les icônes vont dans /usr/share.
  const put = (src, dest, mode = 0o644) => {
    const target = path.join(tree, dest);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(src, target);
    chmodSync(target, mode);
  };

  const wrapper = path.join(tree, "usr/bin/solocast");
  mkdirSync(path.dirname(wrapper), { recursive: true });
  writeFileSync(
    wrapper,
    '#!/bin/sh\nunset NODE_OPTIONS\nexec /opt/solocast/node /opt/solocast/solocast.mjs "$@"\n',
  );
  chmodSync(wrapper, 0o755);

  put(path.join(ROOT, "packaging/deb/solocast.desktop"), "usr/share/applications/solocast.desktop");
  put(path.join(opt, "solocast.svg"), "usr/share/icons/hicolor/scalable/apps/solocast.svg");
  put(
    path.join(ROOT, "packaging/icon-256.png"),
    "usr/share/icons/hicolor/256x256/apps/solocast.png",
  );
  put(path.join(ROOT, "packaging/deb/copyright"), "usr/share/doc/solocast/copyright");
  put(path.join(ROOT, "packaging/deb/lintian-overrides"), "usr/share/lintian/overrides/solocast");

  // Documentation : changelog (Debian exige changelog.gz) et page de manuel.
  const date = new Date(SOURCE_DATE_EPOCH * 1000).toUTCString().replace("GMT", "+0000");
  const changelog = [
    `solocast (${debVersion}) unstable; urgency=medium`,
    "",
    `  * Release ${version}.`,
    "",
    ` -- ${MAINTAINER}  ${date}`,
    "",
  ].join("\n");
  const docDir = path.join(tree, "usr/share/doc/solocast");
  writeFileSync(path.join(docDir, "changelog.gz"), gzipSync(Buffer.from(changelog), { level: 9 }));
  const manDir = path.join(tree, "usr/share/man/man1");
  mkdirSync(manDir, { recursive: true });
  writeFileSync(
    path.join(manDir, "solocast.1.gz"),
    gzipSync(readFileSync(path.join(ROOT, "packaging/deb/solocast.1")), { level: 9 }),
  );

  // DEBIAN/ : control, md5sums, prerm.
  const debian = path.join(tree, "DEBIAN");
  mkdirSync(debian, { recursive: true });
  const size = dirSizeKb(tree);
  writeFileSync(
    path.join(debian, "control"),
    readFileSync(path.join(ROOT, "packaging/deb/control.in"), "utf8")
      .replace("@VERSION@", debVersion)
      .replace("@SIZE@", String(size)),
  );
  const sums = listFiles(tree)
    .filter((f) => !f.startsWith("DEBIAN/"))
    .map((f) => `${md5Of(path.join(tree, f))}  ${f}`)
    .join("\n");
  writeFileSync(path.join(debian, "md5sums"), `${sums}\n`);
  copyFileSync(path.join(ROOT, "packaging/deb/prerm"), path.join(debian, "prerm"));
  chmodSync(path.join(debian, "prerm"), 0o755);

  stampTree(tree);
  const deb = path.join(OUT, `solocast_${debVersion}_amd64.deb`);
  if (dryRun) {
    console.log(`  --dry-run : arbre du paquet dans ${path.relative(ROOT, tree)}`);
    return tree;
  }
  run("dpkg-deb", ["--build", "--root-owner-group", "-Zxz", tree, deb], {
    env: { ...process.env, SOURCE_DATE_EPOCH: String(SOURCE_DATE_EPOCH) },
  });
  return deb;
}

function md5Of(file) {
  return createHash("md5").update(readFileSync(file)).digest("hex");
}

/** SoloCast.exe : petit lanceur sans console, construit avec le makensis déjà requis. */
function buildLauncher(outFile) {
  if (!has("makensis", ["-VERSION"])) {
    throw new Error("makensis introuvable (apt install nsis / pacman -S nsis)");
  }
  run("makensis", [
    "-V2",
    "-INPUTCHARSET",
    "UTF8",
    `-DOUTFILE=${outFile}`,
    `-DICON=${path.join(ROOT, "packaging/win/solocast.ico")}`,
    `-DVERSION=${version}`,
    `-DVERSION4=${version4}`,
    path.join(ROOT, "packaging/win/launcher.nsi"),
  ]);
}

function buildExe(staged) {
  if (!has("makensis", ["-VERSION"])) {
    throw new Error("makensis introuvable (apt install nsis / pacman -S nsis)");
  }
  const exe = path.join(OUT, `SoloCast-Setup-${version}.exe`);
  run("makensis", [
    "-V2",
    "-INPUTCHARSET",
    "UTF8",
    `-DVERSION=${version}`,
    `-DVERSION4=${version4}`,
    `-DSRC=${staged}`,
    `-DOUTFILE=${exe}`,
    `-DICON=${path.join(ROOT, "packaging/win/solocast.ico")}`,
    path.join(ROOT, "packaging/win/solocast.nsi"),
  ]);
  return exe;
}

console.log(`SoloCast ${version} — cible : ${target}`);
console.log("Construction du site et du lanceur…");
run("pnpm", ["--filter", "@solocast/shared", "build"], { cwd: ROOT });
run("pnpm", ["--filter", "@solocast/web", "build:static"], { cwd: ROOT });
run("pnpm", ["--filter", "@solocast/backend", "bundle"], {
  cwd: ROOT,
  env: { ...process.env, SOLOCAST_VERSION: version },
});

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const produced = [];
if (target === "deb" || target === "all") {
  console.log("Paquet Debian…");
  produced.push(buildDeb(await stageFor("linux")));
}
if (target === "win" || target === "all") {
  console.log("Installeur Windows…");
  produced.push(buildExe(await stageFor("win")));
}

const sums = produced
  .filter((file) => statSync(file).isFile())
  .map((file) => `${sha256Of(file)}  ${path.basename(file)}`)
  .join("\n");
writeFileSync(path.join(OUT, "SHA256SUMS"), `${sums}\n`);
console.log(`\nProduit dans ${path.relative(ROOT, OUT)} :\n${sums}`);
