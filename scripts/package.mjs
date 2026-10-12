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
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const version =
  arg("version", undefined) ??
  JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
const target = arg("target", "all");
if (!["deb", "win", "all"].includes(target))
  throw new Error("--target doit valoir deb, win ou all");
if (!/^\d+\.\d+\.\d+([-.][0-9A-Za-z.-]+)?$/.test(version))
  throw new Error(`Version invalide : ${version}`);

const run = (cmd, args, options = {}) => execFileSync(cmd, args, { stdio: "inherit", ...options });
const has = (cmd, probe = ["--version"]) => {
  try {
    execFileSync(cmd, probe, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

async function download({ url, sha256 }) {
  mkdirSync(CACHE, { recursive: true });
  const file = path.join(CACHE, `${sha256.slice(0, 12)}-${path.basename(url)}`);
  const verify = () => createHash("sha256").update(readFileSync(file)).digest("hex") === sha256;
  if (existsSync(file) && verify()) return file;
  console.log(`  télécharge ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) throw new Error(`${url} : HTTP ${String(response.status)}`);
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  if (!verify()) {
    rmSync(file);
    throw new Error(`SHA-256 inattendu pour ${url}`);
  }
  return file;
}

function unzipMember(zip, pattern, destDir) {
  mkdirSync(destDir, { recursive: true });
  if (has("unzip")) run("unzip", ["-q", "-j", "-o", zip, pattern, "-d", destDir]);
  else run("7z", ["e", "-y", `-o${destDir}`, zip, pattern]);
}

async function stageFor(os) {
  const dir = path.join(STAGE, os);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const ext = os === "win" ? ".exe" : "";
  const up = UPSTREAM[os];

  const nodeFile = await download(up.node);
  if (os === "win") {
    unzipMember(nodeFile, "node-*/node.exe", dir);
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
  }

  // Licences à redistribuer avec les binaires (Node MIT, LiveKit et cloudflared Apache-2.0).
  const licenseDir = path.join(dir, "licenses");
  mkdirSync(licenseDir, { recursive: true });
  const tmp = path.join(STAGE, `${os}-license-tmp`);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  if (os === "win") {
    unzipMember(nodeFile, "node-*/LICENSE", tmp);
  } else {
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

  const livekitFile = await download(up.livekit);
  if (os === "win") unzipMember(livekitFile, "livekit-server.exe", dir);
  else run("tar", ["-xzf", livekitFile, "-C", dir, "livekit-server"]);
  rmSync(tmp, { recursive: true, force: true });
  mkdirSync(tmp, { recursive: true });
  if (os === "win") unzipMember(livekitFile, "LICENSE", tmp);
  else run("tar", ["-xzf", livekitFile, "-C", tmp, "LICENSE"]);
  copyFileSync(path.join(tmp, "LICENSE"), path.join(licenseDir, "livekit-LICENSE"));
  rmSync(tmp, { recursive: true, force: true });

  const cfLicense = await fetch(
    `https://raw.githubusercontent.com/cloudflare/cloudflared/${CLOUDFLARED_VERSION}/LICENSE`,
  );
  const cfText = cfLicense.ok ? await cfLicense.text() : "";
  if (!cfText.includes("Apache License")) throw new Error("Licence de cloudflared introuvable");
  writeFileSync(path.join(licenseDir, "cloudflared-LICENSE"), cfText);

  copyFileSync(await download(up.cloudflared), path.join(dir, `cloudflared${ext}`));

  copyFileSync(path.join(ROOT, "apps/backend/dist/solocast.mjs"), path.join(dir, "solocast.mjs"));
  cpSync(path.join(ROOT, "apps/web/out"), path.join(dir, "web"), { recursive: true });
  copyFileSync(path.join(ROOT, "apps/web/app/icon.svg"), path.join(dir, "solocast.svg"));
  if (os === "win") {
    copyFileSync(path.join(ROOT, "packaging/win/solocast.ico"), path.join(dir, "solocast.ico"));
    copyFileSync(path.join(ROOT, "packaging/win/solocast.vbs"), path.join(dir, "solocast.vbs"));
  }
  writeFileSync(
    path.join(dir, "THIRD_PARTY.txt"),
    [
      "SoloCast embarque ces programmes, distribués séparément par leurs auteurs.",
      "Leurs licences sont dans le dossier licenses/. Les dépendances JavaScript du lanceur",
      "(Fastify, ws, jose, livekit-server-sdk…) gardent leurs avis en fin de solocast.mjs.",
      "",
      "",
      `- Node.js ${NODE_VERSION} (MIT)            https://nodejs.org`,
      `- LiveKit server ${LIVEKIT_VERSION} (Apache-2.0)  https://github.com/livekit/livekit`,
      `- cloudflared ${CLOUDFLARED_VERSION} (Apache-2.0)  https://github.com/cloudflare/cloudflared`,
      "",
    ].join("\n"),
  );
  for (const name of ["node", "livekit-server", "cloudflared"]) {
    const file = path.join(dir, `${name}${ext}`);
    if (existsSync(file)) chmodSync(file, 0o755);
  }
  return dir;
}

function dirSizeKb(dir) {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSizeKb(full) * 1024 : statSync(full).size;
  }
  return Math.ceil(total / 1024);
}

function buildDeb(staged) {
  if (!has("dpkg-deb")) throw new Error("dpkg-deb introuvable (apt install dpkg / pacman -S dpkg)");
  const tree = path.join(STAGE, "deb-tree");
  rmSync(tree, { recursive: true, force: true });
  const opt = path.join(tree, "opt/solocast");
  cpSync(staged, opt, { recursive: true });

  mkdirSync(path.join(tree, "usr/bin"), { recursive: true });
  const wrapper = path.join(tree, "usr/bin/solocast");
  writeFileSync(wrapper, '#!/bin/sh\nexec /opt/solocast/node /opt/solocast/solocast.mjs "$@"\n');
  chmodSync(wrapper, 0o755);

  mkdirSync(path.join(tree, "usr/share/applications"), { recursive: true });
  copyFileSync(
    path.join(ROOT, "packaging/deb/solocast.desktop"),
    path.join(tree, "usr/share/applications/solocast.desktop"),
  );
  mkdirSync(path.join(tree, "usr/share/icons/hicolor/scalable/apps"), { recursive: true });
  copyFileSync(
    path.join(opt, "solocast.svg"),
    path.join(tree, "usr/share/icons/hicolor/scalable/apps/solocast.svg"),
  );

  mkdirSync(path.join(tree, "usr/share/icons/hicolor/256x256/apps"), { recursive: true });
  copyFileSync(
    path.join(ROOT, "packaging/icon-256.png"),
    path.join(tree, "usr/share/icons/hicolor/256x256/apps/solocast.png"),
  );

  mkdirSync(path.join(tree, "DEBIAN"), { recursive: true });
  const control = readFileSync(path.join(ROOT, "packaging/deb/control.in"), "utf8")
    .replace("@VERSION@", version)
    .replace("@SIZE@", String(dirSizeKb(tree)));
  writeFileSync(path.join(tree, "DEBIAN/control"), control);

  const deb = path.join(OUT, `solocast_${version}_amd64.deb`);
  run("dpkg-deb", ["--build", "--root-owner-group", "-Zxz", tree, deb]);
  return deb;
}

function buildExe(staged) {
  if (!has("makensis", ["-VERSION"]))
    throw new Error("makensis introuvable (apt install nsis / pacman -S nsis)");
  const exe = path.join(OUT, `SoloCast-Setup-${version}.exe`);
  run("makensis", [
    "-V2",
    "-INPUTCHARSET",
    "UTF8",
    `-DVERSION=${version}`,
    `-DSRC=${staged}`,
    `-DOUTFILE=${exe}`,
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
  .map(
    (file) =>
      `${createHash("sha256").update(readFileSync(file)).digest("hex")}  ${path.basename(file)}`,
  )
  .join("\n");
writeFileSync(path.join(OUT, "SHA256SUMS"), `${sums}\n`);
console.log(`\nProduit dans ${path.relative(ROOT, OUT)} :\n${sums}`);
