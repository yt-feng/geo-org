import { createHash, randomBytes, randomUUID } from "node:crypto";
import { chmod, link, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const hash = value => createHash("sha256").update(value).digest("hex");
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
function code() { return "TK-" + [...randomBytes(32)].map(value => ALPHABET[value & 31]).join("").match(/.{4}/g).join("-"); }
async function privateFile(filename, content, exclusive = false) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(content, "utf8"); await handle.sync(); } finally { await handle.close(); }
  try { if (exclusive) await link(temporary, filename); else await rename(temporary, filename); }
  finally { await unlink(temporary).catch(() => {}); }
  await chmod(filename, 0o600);
}

export async function prepareInventory({ batch, actor = "admin", count = 20, usdCny = "7.2", root = process.cwd() }) {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(batch || "")) throw new Error("Use --batch with a stable 8–80 character identifier.");
  if (!/^[a-zA-Z0-9._:-]{1,200}$/.test(actor)) throw new Error("Invalid actor ID.");
  if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error("Offline atomic imports support 1–100 codes per offer. Use another batch identifier for more stock.");
  const rate = Number(usdCny);
  if (!Number.isFinite(rate) || rate < 0.01 || rate > 1000) throw new Error("Invalid fixed recharge conversion.");
  const directory = path.join(root, ".artifacts", "tokvilo-private", batch);
  await mkdir(directory, { recursive: true, mode: 0o700 }); await chmod(directory, 0o700);
  const manifestPath = path.join(directory, "manifest.json");
  let manifest;
  try { manifest = JSON.parse(await readFile(manifestPath, "utf8")); }
  catch (cause) {
    if (cause.code !== "ENOENT") throw new Error("The saved manifest is unreadable; preserve it and recover it before creating more inventory.");
    const note = `Tokvilo Liandong inventory ${batch}`, at = new Date().toISOString();
    const offers = [30, 90, 300].map(amount => {
      const codes = Array.from({ length: count }, code);
      return { id: randomUUID(), request_id: randomUUID(), fingerprint: hash(JSON.stringify({ packageId: String(amount), count, note, expiresAt: null })),
        package_id: String(amount), amount_cny: amount, credit_microusd: Math.floor(amount * 1_000_000 / rate), usd_cny: String(rate),
        count, note, created_by: actor, created_at: at, expires_at: null,
        codes: codes.map(plaintext => ({ id: randomUUID(), code_hash: hash(plaintext.replaceAll("-", "")), code_suffix: plaintext.replaceAll("-", "").slice(-6), plaintext })) };
    });
    const candidate = { format: "tokvilo-inventory-v1", batch, actor, count, usdCny: String(rate), offers };
    try { await privateFile(manifestPath, JSON.stringify(candidate, null, 2) + "\n", true); }
    catch (cause) { if (cause.code !== "EEXIST") throw cause; }
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  }
  if (manifest.format !== "tokvilo-inventory-v1" || manifest.batch !== batch || manifest.actor !== actor || manifest.count !== count || manifest.usdCny !== String(rate)) throw new Error("Saved inventory parameters differ. Use the original arguments to recover this batch.");
  if (!Array.isArray(manifest.offers) || manifest.offers.length !== 3) throw new Error("Saved inventory manifest is incomplete.");
  // Verify every recoverable plaintext code against its stored hash before
  // producing an import or delivery file. Do not print any inventory content.
  for (const offer of manifest.offers) {
    if (offer.codes.length !== count || ![30, 90, 300].includes(offer.amount_cny) || offer.credit_microusd !== Math.floor(offer.amount_cny * 1_000_000 / rate)) throw new Error("Saved inventory offer is inconsistent.");
    for (const value of offer.codes) if (!/^TK(?:-[A-HJ-NP-Z2-9]{4}){8}$/.test(value.plaintext) || hash(value.plaintext.replaceAll("-", "")) !== value.code_hash || value.plaintext.replaceAll("-", "").slice(-6) !== value.code_suffix) throw new Error("Saved inventory failed its integrity check.");
  }
  const inventory = manifest.offers.map(offer => ({ ...offer, codes: offer.codes.map(value => ({ id: value.id, code_hash: value.code_hash, code_suffix: value.code_suffix })) }));
  const inventoryJson = JSON.stringify(inventory);
  const sql = `-- Hash-only Tokvilo inventory. The named active operator must already exist.\n-- One INSERT triggers an atomic import. Re-running this exact file is idempotent.\nINSERT INTO tokvilo_inventory_imports(id,fingerprint,inventory_json)\nVALUES(${quote(batch)},${quote(hash(inventoryJson))},${quote(inventoryJson)}) ON CONFLICT(id) DO NOTHING;\n`;
  if (Buffer.byteLength(sql, "utf8") > 90_000) throw new Error("Import exceeds the D1 statement budget; preserve the manifest and use a smaller new batch.");
  const sqlPath = path.join(directory, "import.sql");
  await privateFile(sqlPath, sql);
  const files = [];
  for (const offer of manifest.offers) {
    const filename = path.join(directory, `tokvilo-cny-${offer.amount_cny}.txt`);
    await privateFile(filename, offer.codes.map(value => value.plaintext).join("\n") + "\n");
    files.push({ amountCny: offer.amount_cny, creditMicrousd: offer.credit_microusd, count: offer.count, file: filename, batchId: offer.id });
  }
  return { directory, sqlPath, manifestPath, totalCodes: count * 3, files };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {};
  for (let index = 2; index < process.argv.length; index += 2) {
    const name = process.argv[index], value = process.argv[index + 1];
    if (!["--batch", "--actor", "--count", "--usd-cny"].includes(name) || !value) throw new Error("Usage: node scripts/prepare-tokvilo-inventory.mjs --batch tokvilo-launch-20261020 --actor admin --count 20 --usd-cny 7.2");
    options[name] = value;
  }
  try {
    const result = await prepareInventory({ batch: options["--batch"], actor: options["--actor"] || "admin", count: Number(options["--count"] || 20), usdCny: options["--usd-cny"] || "7.2" });
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (cause) { process.stderr.write((cause instanceof Error ? cause.message : "Inventory preparation failed.") + "\n"); process.exitCode = 1; }
}
