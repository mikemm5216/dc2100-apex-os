const fs = require("fs");
const path = require("path");

const rosterPath = path.join(__dirname, "..", "config", "locked-canon-roster-15-v1.json");

const expected = [
  ["CANDIDATE_SLOT_01", "麥克斯 (Max)", "黑鴉 GTO", "Pontiac", "GTO", "1970 Pontiac GTO"],
  ["CANDIDATE_SLOT_02", "肯吉 (Kenji)", "沖繩野馬", "Ford", "Mustang", "Mustang Dark Horse"],
  ["CANDIDATE_SLOT_03", "米克 (Mick)", "澳洲瘋子", "Ford", "Falcon", "Falcon XR6 Turbo"],
  ["CANDIDATE_SLOT_04", "阿洋 (Yang)", "狂龍號", "Audi", "TT", "TT RS"],
  ["CANDIDATE_SLOT_05", "貝蒂 (Betty)", "拉力硬皮鯊", "Subaru", "Impreza", "Impreza GC8"],
  ["CANDIDATE_SLOT_06", "煙鬼 (Smokey)", "金魔 Supra", "Toyota", "Supra", "Supra"],
  ["CANDIDATE_SLOT_07", "VTEC 信徒", "萬轉本田", "Honda", "Civic", "Civic Type R"],
  ["CANDIDATE_SLOT_08", "凌宇（神經元）", "小米 SU7 Ultra", "Xiaomi", "SU7", "SU7 Ultra"],
  ["CANDIDATE_SLOT_09", "金 (Kim)", "電競魔王", "Hyundai", "Elantra", "Elantra N"],
  ["CANDIDATE_SLOT_10", "漢斯 (Hans)", "綠色皇帝", "Porsche", "911", "911 GT3 RS"],
  ["CANDIDATE_SLOT_11", "亞歷山德羅 (Alessandro)", "紅衣騎士", "Ferrari", "488", "488 Pista"],
  ["CANDIDATE_SLOT_12", "幽靈 (The Specter)", "白色亡靈", "Lotus", "Exige", "Exige Cup 430"],
  ["CANDIDATE_SLOT_13", "埃里克 (Erik)", "飛行磚塊", "Volvo", "850", "850 R Estate"],
  ["CANDIDATE_SLOT_14", "柯林 (Colin)", "拉力亡魂", "Mitsubishi", "Lancer", "Lancer Evolution VIII"],
  ["CANDIDATE_SLOT_15", null, "傳奇繼承者", "Toyota", "86", "86"]
];

function hasReviewFlag(slot, field) {
  return Array.isArray(slot.review_flags) &&
    slot.review_flags.includes(`CANON_FIELD_REVIEW_REQUIRED:${field}`);
}

function validateRoster(roster) {
  const errors = [];
  const reviews = [];
  const slots = Array.isArray(roster.slots) ? roster.slots : [];
  if (slots.length !== 15) errors.push(`expected exactly 15 slots, received ${slots.length}`);

  const ids = new Set();
  const numbers = new Set();
  for (let index = 0; index < slots.length; index += 1) {
    const slot = slots[index];
    const exp = expected[index];
    if (!exp) continue;
    const [slotId, driver, vehicleName, brand, series, model] = exp;

    if (ids.has(slot.slot_id)) errors.push(`duplicate slot_id: ${slot.slot_id}`);
    ids.add(slot.slot_id);
    if (numbers.has(slot.slot_number)) errors.push(`duplicate slot_number: ${slot.slot_number}`);
    numbers.add(slot.slot_number);

    if (slot.slot_id !== slotId) errors.push(`${slotId}: slot order/id changed`);
    if (slot.slot_number !== index + 1) errors.push(`${slotId}: slot_number must be ${index + 1}`);
    if (slot.canon_vehicle_name !== vehicleName) errors.push(`${slotId}: canon vehicle name changed`);
    if (!slot.vehicle || slot.vehicle.brand !== brand || slot.vehicle.series !== series || slot.vehicle.model !== model) {
      errors.push(`${slotId}: vehicle identity changed`);
    }
    if (!/^[A-Z]{2}$/.test(slot.canon_country_code || "")) errors.push(`${slotId}: canon_country_code missing or invalid`);

    if (driver === null) {
      if (slot.canon_driver_name !== null) errors.push(`${slotId}: prohibited source driver must not be persisted`);
      if (!hasReviewFlag(slot, "canon_driver_name")) errors.push(`${slotId}: missing review flag for canon_driver_name`);
      reviews.push(`${slotId}:canon_driver_name`);
    } else if (slot.canon_driver_name !== driver) {
      errors.push(`${slotId}: canon driver changed or is not the extracted fictional identity`);
    }

    for (const field of ["team_name", "driver_archetype", "story_function"]) {
      if (slot[field] === null) {
        if (!hasReviewFlag(slot, field)) errors.push(`${slotId}: null ${field} lacks review flag`);
        else reviews.push(`${slotId}:${field}`);
      }
    }
  }

  return { valid: errors.length === 0, status: errors.length ? "FAILED" : reviews.length ? "CANON_FIELD_REVIEW_REQUIRED" : "PASS", errors, reviews };
}

if (require.main === module) {
  const roster = JSON.parse(fs.readFileSync(rosterPath, "utf8"));
  const result = validateRoster(roster);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.valid) process.exitCode = 1;
}

module.exports = { validateRoster };
