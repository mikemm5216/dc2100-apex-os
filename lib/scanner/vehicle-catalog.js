// =========================================================
// VEHICLE CATALOG — Task 3.3C
//
// Compact canonical catalog for the deterministic entity
// resolver. High precision beats coverage: every alias must
// be unambiguous on its own, so single generic tokens like
// "gt", "gr", "rs", "m", "s", "ram", or "mini" are banned.
// Prefer UNRESOLVED over a wrong match.
// =========================================================

const VEHICLE_TYPES = [
  "HYPERCAR",
  "SUPERCAR",
  "SPORTS_CAR",
  "MUSCLE_CAR",
  "RALLY_CAR",
  "DRAG_CAR",
  "SEDAN",
  "COUPE",
  "HATCHBACK",
  "WAGON",
  "SUV",
  "TRUCK",
  "OFF_ROAD",
  "EV",
  "CLASSIC",
  "OTHER",
  "UNKNOWN"
];

// Aliases that must never appear standalone in the catalog
// because they collide with everyday words or substrings.
const BANNED_ALIASES = new Set([
  "m",
  "s",
  "e",
  "3",
  "6",
  "7",
  "86",
  "911",
  "gt",
  "gr",
  "rs",
  "st",
  "sti",
  "amg",
  "ram",
  "mini",
  "type",
  "ultra",
  "model",
  "id",
  "up",
  "e class",
  "eclass"
]);

// ---------------------------------------------------------
// Real vehicle DB code derivation — Task 3.3F catalog bridge
//
// Canonical real-vehicle database code: compact(brand + model).
// This is the single source of truth for that formula: the
// resolver's DB lookup and the catalog/DB parity test both call
// this instead of duplicating the regex.
// ---------------------------------------------------------

function compactVehicleCode(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

// Legacy fallback DB codes that are too generic to trust as a
// vehicle match on their own. A signal matching one of these
// short/common tokens must never resolve to a specific vehicle.
const GENERIC_UNSAFE_VEHICLE_CODES = new Set([
  "GT",
  "86",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "RS",
  "STI",
  "ULTRA"
]);

const BRAND_CATALOG = [
  {
    brand: "Toyota",
    countryCode: "JP",
    aliases: ["toyota", "toyota gazoo racing", "gazoo racing"]
  },
  {
    brand: "Lexus",
    countryCode: "JP",
    aliases: ["lexus"]
  },
  {
    brand: "Honda",
    countryCode: "JP",
    aliases: ["honda"]
  },
  {
    brand: "Nissan",
    countryCode: "JP",
    aliases: ["nissan"]
  },
  {
    brand: "Mazda",
    countryCode: "JP",
    aliases: ["mazda"]
  },
  {
    brand: "Subaru",
    countryCode: "JP",
    aliases: ["subaru"]
  },
  {
    brand: "Mitsubishi",
    countryCode: "JP",
    aliases: ["mitsubishi"]
  },
  {
    brand: "BMW",
    countryCode: "DE",
    aliases: ["bmw"]
  },
  {
    brand: "Mercedes-AMG",
    countryCode: "DE",
    aliases: [
      "mercedes-amg",
      "mercedes amg",
      "mercedes",
      "mercedes-benz",
      "mercedes benz"
    ]
  },
  {
    brand: "Porsche",
    countryCode: "DE",
    aliases: ["porsche"]
  },
  {
    brand: "Audi",
    countryCode: "DE",
    aliases: ["audi"]
  },
  {
    brand: "Volkswagen",
    countryCode: "DE",
    aliases: ["volkswagen"]
  },
  {
    brand: "Ford",
    countryCode: "US",
    aliases: ["ford"]
  },
  {
    brand: "Chevrolet",
    countryCode: "US",
    aliases: ["chevrolet", "chevy"]
  },
  {
    brand: "Dodge",
    countryCode: "US",
    aliases: ["dodge"]
  },
  {
    brand: "Tesla",
    countryCode: "US",
    aliases: ["tesla"]
  },
  {
    brand: "Ferrari",
    countryCode: "IT",
    aliases: ["ferrari"]
  },
  {
    brand: "Lamborghini",
    countryCode: "IT",
    aliases: ["lamborghini", "lambo"]
  },
  {
    brand: "McLaren",
    countryCode: "GB",
    aliases: ["mclaren"]
  },
  {
    brand: "Aston Martin",
    countryCode: "GB",
    aliases: ["aston martin"]
  },
  {
    brand: "Lotus",
    countryCode: "GB",
    aliases: ["lotus"]
  },
  {
    brand: "Xiaomi",
    countryCode: "CN",
    aliases: ["xiaomi"]
  },
  {
    brand: "BYD",
    countryCode: "CN",
    aliases: ["byd"]
  },
  {
    brand: "Hyundai",
    countryCode: "KR",
    aliases: ["hyundai", "hyundai n"]
  },
  {
    brand: "Kia",
    countryCode: "KR",
    aliases: ["kia"]
  },
  {
    brand: "Bugatti",
    countryCode: "FR",
    aliases: ["bugatti"]
  },
  {
    brand: "Alpine",
    countryCode: "FR",
    aliases: ["alpine"]
  },
  {
    brand: "Volvo",
    countryCode: "SE",
    aliases: ["volvo"]
  },
  {
    brand: "Koenigsegg",
    countryCode: "SE",
    aliases: ["koenigsegg"]
  },
  {
    brand: "Rimac",
    countryCode: "HR",
    aliases: ["rimac"]
  }
];

// Series entries resolve Brand + Series without a specific
// model. Aliases must carry the brand context themselves.
const SERIES_CATALOG = [
  {
    brand: "Toyota",
    series: "GR",
    countryCode: "JP",
    vehicleType: "UNKNOWN",
    aliases: ["toyota gr"]
  },
  {
    brand: "BMW",
    series: "M",
    countryCode: "DE",
    vehicleType: "UNKNOWN",
    aliases: ["bmw m division"]
  },
  {
    brand: "Porsche",
    series: "911",
    countryCode: "DE",
    vehicleType: "SPORTS_CAR",
    aliases: ["porsche 911"]
  },
  {
    brand: "Hyundai",
    series: "N",
    countryCode: "KR",
    vehicleType: "UNKNOWN",
    aliases: ["hyundai n performance"]
  }
];

const MODEL_CATALOG = [
  {
    brand: "Toyota",
    series: "GR",
    model: "GR GT",
    countryCode: "JP",
    vehicleType: "SPORTS_CAR",
    aliases: ["toyota gr gt", "gr gt"]
  },
  {
    brand: "Toyota",
    series: "GR",
    model: "GR Supra",
    countryCode: "JP",
    vehicleType: "SPORTS_CAR",
    aliases: ["toyota gr supra", "gr supra", "supra"]
  },
  {
    brand: "Toyota",
    series: "GR",
    model: "GR86",
    countryCode: "JP",
    vehicleType: "SPORTS_CAR",
    aliases: ["toyota gr86", "toyota gr 86", "gr86", "gr 86"]
  },
  {
    brand: "Toyota",
    series: "GR",
    model: "GR Yaris",
    countryCode: "JP",
    vehicleType: "RALLY_CAR",
    aliases: ["toyota gr yaris", "gr yaris"]
  },
  {
    brand: "Xiaomi",
    series: "SU7",
    model: "SU7 Ultra",
    countryCode: "CN",
    vehicleType: "EV",
    aliases: ["xiaomi su7 ultra", "su7 ultra"]
  },
  {
    brand: "Xiaomi",
    series: "SU7",
    model: "SU7",
    countryCode: "CN",
    vehicleType: "EV",
    aliases: ["xiaomi su7", "su7"]
  },
  {
    brand: "Porsche",
    series: "911",
    model: "911 GT3 RS",
    countryCode: "DE",
    vehicleType: "SPORTS_CAR",
    aliases: ["porsche 911 gt3 rs", "911 gt3 rs", "gt3 rs", "gt3rs"]
  },
  {
    brand: "Porsche",
    series: "911",
    model: "911 GT3",
    countryCode: "DE",
    vehicleType: "SPORTS_CAR",
    aliases: ["porsche 911 gt3", "911 gt3", "gt3"]
  },
  {
    brand: "Porsche",
    series: "Taycan",
    model: "Taycan",
    countryCode: "DE",
    vehicleType: "EV",
    aliases: ["porsche taycan", "taycan"]
  },
  {
    brand: "Ford",
    series: "Mustang",
    model: "Mustang",
    countryCode: "US",
    vehicleType: "MUSCLE_CAR",
    aliases: ["ford mustang", "mustang"]
  },
  {
    brand: "BMW",
    series: "M",
    model: "M2",
    countryCode: "DE",
    vehicleType: "SPORTS_CAR",
    aliases: ["bmw m2", "m2 competition"]
  },
  {
    brand: "BMW",
    series: "M",
    model: "M3",
    countryCode: "DE",
    vehicleType: "SPORTS_CAR",
    aliases: ["bmw m3", "m3"]
  },
  {
    brand: "BMW",
    series: "M",
    model: "M4",
    countryCode: "DE",
    vehicleType: "SPORTS_CAR",
    aliases: ["bmw m4", "m4"]
  },
  {
    brand: "BMW",
    series: "M",
    model: "M5",
    countryCode: "DE",
    vehicleType: "SEDAN",
    aliases: ["bmw m5", "m5"]
  },
  {
    brand: "Mercedes-AMG",
    series: "AMG GT",
    model: "AMG GT",
    countryCode: "DE",
    vehicleType: "SPORTS_CAR",
    aliases: [
      "mercedes-amg gt",
      "mercedes amg gt",
      "amg gt"
    ]
  },
  {
    brand: "Nissan",
    series: "GT-R",
    model: "GT-R",
    countryCode: "JP",
    vehicleType: "SPORTS_CAR",
    aliases: ["nissan gt-r", "nissan gtr", "gt-r", "gtr", "gt-r nismo"]
  },
  {
    brand: "Mazda",
    series: "RX",
    model: "RX-7",
    countryCode: "JP",
    vehicleType: "SPORTS_CAR",
    aliases: ["mazda rx-7", "mazda rx7", "rx-7", "rx7"]
  },
  {
    brand: "Mazda",
    series: "MX-5",
    model: "MX-5 Miata",
    countryCode: "JP",
    vehicleType: "SPORTS_CAR",
    aliases: ["mazda mx-5", "mx-5", "mx5", "miata"]
  },
  {
    brand: "Subaru",
    series: "WRX",
    model: "WRX STI",
    countryCode: "JP",
    vehicleType: "RALLY_CAR",
    aliases: ["subaru wrx sti", "wrx sti", "subaru sti"]
  },
  {
    brand: "Subaru",
    series: "WRX",
    model: "WRX",
    countryCode: "JP",
    vehicleType: "SEDAN",
    aliases: ["subaru wrx", "wrx"]
  },
  {
    brand: "Chevrolet",
    series: "Corvette",
    model: "Corvette",
    countryCode: "US",
    vehicleType: "SPORTS_CAR",
    aliases: ["chevrolet corvette", "chevy corvette", "corvette"]
  },
  {
    brand: "Dodge",
    series: "Challenger",
    model: "Challenger",
    countryCode: "US",
    vehicleType: "MUSCLE_CAR",
    aliases: ["dodge challenger", "challenger hellcat"]
  },
  {
    brand: "Dodge",
    series: "Charger",
    model: "Charger",
    countryCode: "US",
    vehicleType: "MUSCLE_CAR",
    aliases: ["dodge charger", "charger hellcat"]
  },
  {
    brand: "Ferrari",
    series: "SF90",
    model: "SF90",
    countryCode: "IT",
    vehicleType: "HYPERCAR",
    aliases: ["ferrari sf90", "sf90", "sf90 stradale"]
  },
  {
    brand: "Lamborghini",
    series: "Revuelto",
    model: "Revuelto",
    countryCode: "IT",
    vehicleType: "SUPERCAR",
    aliases: ["lamborghini revuelto", "revuelto"]
  },
  {
    brand: "Lamborghini",
    series: "Huracan",
    model: "Huracan",
    countryCode: "IT",
    vehicleType: "SUPERCAR",
    aliases: ["lamborghini huracan", "huracan"]
  },
  {
    brand: "McLaren",
    series: "750S",
    model: "750S",
    countryCode: "GB",
    vehicleType: "SUPERCAR",
    aliases: ["mclaren 750s", "750s"]
  },
  {
    brand: "Audi",
    series: "RS",
    model: "RS6",
    countryCode: "DE",
    vehicleType: "WAGON",
    aliases: ["audi rs6", "audi rs 6", "rs6", "rs 6 avant", "rs6 avant"]
  },
  {
    brand: "Audi",
    series: "TT",
    model: "TT RS",
    countryCode: "DE",
    vehicleType: "SPORTS_CAR",
    aliases: ["audi tt rs", "tt rs", "ttrs"]
  },
  {
    brand: "Honda",
    series: "Civic",
    model: "Civic Type R",
    countryCode: "JP",
    vehicleType: "HATCHBACK",
    aliases: ["honda civic type r", "civic type r", "type r"]
  },
  {
    brand: "Honda",
    series: "Civic",
    model: "Civic",
    countryCode: "JP",
    vehicleType: "HATCHBACK",
    aliases: ["honda civic", "civic"]
  },
  {
    brand: "Honda",
    series: "NSX",
    model: "NSX",
    countryCode: "JP",
    vehicleType: "SPORTS_CAR",
    aliases: ["honda nsx", "acura nsx", "nsx"]
  },
  {
    brand: "Hyundai",
    series: "N",
    model: "Ioniq 5 N",
    countryCode: "KR",
    vehicleType: "EV",
    aliases: ["hyundai ioniq 5 n", "ioniq 5 n"]
  },
  {
    brand: "Lotus",
    series: "Exige",
    model: "Exige",
    countryCode: "GB",
    vehicleType: "SPORTS_CAR",
    aliases: ["lotus exige", "exige"]
  },
  {
    brand: "Mitsubishi",
    series: "Lancer",
    model: "Lancer Evolution",
    countryCode: "JP",
    vehicleType: "RALLY_CAR",
    aliases: [
      "mitsubishi lancer evolution",
      "lancer evolution",
      "lancer evo",
      "mitsubishi evo"
    ]
  },
  {
    brand: "Rimac",
    series: "Nevera",
    model: "Nevera",
    countryCode: "HR",
    vehicleType: "HYPERCAR",
    aliases: ["rimac nevera", "nevera"]
  },
  {
    brand: "Koenigsegg",
    series: "Jesko",
    model: "Jesko",
    countryCode: "SE",
    vehicleType: "HYPERCAR",
    aliases: ["koenigsegg jesko", "jesko"]
  },
  {
    brand: "Bugatti",
    series: "Chiron",
    model: "Chiron",
    countryCode: "FR",
    vehicleType: "HYPERCAR",
    aliases: ["bugatti chiron", "chiron"]
  },
  {
    brand: "Mitsubishi",
    series: "Triton",
    model: "Triton",
    countryCode: "JP",
    vehicleType: "TRUCK",
    aliases: ["mitsubishi triton", "triton pickup"]
  },
  {
    brand: "Hyundai",
    series: "N",
    model: "Ioniq 6 N",
    countryCode: "KR",
    vehicleType: "EV",
    aliases: ["hyundai ioniq 6 n", "ioniq 6 n"]
  }
];

function validateCatalog() {
  const entries = [
    ...BRAND_CATALOG,
    ...SERIES_CATALOG,
    ...MODEL_CATALOG
  ];

  for (const entry of entries) {
    for (const alias of entry.aliases) {
      if (BANNED_ALIASES.has(alias)) {
        throw new Error(
          `Banned catalog alias "${alias}" on ${entry.brand}.`
        );
      }

      if (alias !== alias.toLowerCase()) {
        throw new Error(
          `Catalog alias "${alias}" must be lowercase.`
        );
      }

      if (alias.trim().length < 2) {
        throw new Error(
          `Catalog alias "${alias}" is too short.`
        );
      }
    }
  }

  for (const entry of MODEL_CATALOG) {
    if (!VEHICLE_TYPES.includes(entry.vehicleType)) {
      throw new Error(
        `Unknown vehicle type "${entry.vehicleType}" on ${entry.model}.`
      );
    }
  }
}

validateCatalog();

module.exports = {
  BANNED_ALIASES,
  BRAND_CATALOG,
  GENERIC_UNSAFE_VEHICLE_CODES,
  MODEL_CATALOG,
  SERIES_CATALOG,
  VEHICLE_TYPES,
  compactVehicleCode
};
