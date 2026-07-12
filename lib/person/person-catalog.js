// =========================================================
// PERSON CATALOG — Task 3.3E
//
// Compact high-precision catalog of PUBLIC automotive
// figures with durable vehicle associations. High precision
// beats coverage: every alias must be a full public name
// (or an unambiguous multi-token nickname / CJK name), so
// generic single tokens like "block", "musk", "jun", or
// "ford" are banned and can never match.
//
// Privacy: the catalog stores only public professional
// identity data — never addresses, contacts, family, or
// any private information.
// =========================================================

const CATALOG_VERSION = "vehicle-person-catalog-v1";

const PERSON_ROLES = [
  "FOUNDER_EXECUTIVE",
  "DRIVER_RACER",
  "ENGINEER_DESIGNER",
  "BUILDER_TUNER",
  "CREATOR_MEDIA",
  "COLLECTOR_OWNER",
  "HISTORICAL_FIGURE",
  "OTHER"
];

const RELATION_TYPES = [
  "FOUNDER",
  "EXECUTIVE",
  "DRIVER",
  "RACING_DRIVER",
  "DESIGNER",
  "ENGINEER",
  "BUILDER",
  "TUNER",
  "CREATOR",
  "OWNER",
  "HISTORICAL",
  "OTHER"
];

const LINK_METHODS = [
  "CATALOG",
  "DIRECT_MENTION",
  "MODEL_ASSOCIATION",
  "BRAND_ASSOCIATION",
  "MANUAL"
];

// Aliases that must never appear in the catalog because
// they collide with everyday words, surnames alone, or
// brand names.
const BANNED_PERSON_ALIASES = new Set([
  "block",
  "musk",
  "jun",
  "lei",
  "ford",
  "toyoda",
  "akio",
  "elon",
  "ken",
  "mate",
  "rimac",
  "pagani",
  "shelby",
  "ferrari",
  "lamborghini",
  "bugatti",
  "leno",
  "jay",
  "walker",
  "magnus",
  "harris",
  "chris",
  "watson",
  "mat",
  "doug",
  "gordon",
  "murray",
  "travis",
  "king",
  "drift"
]);

// priority: lower = stronger catalog priority when a brand
// association must be capped to the top relevant people.
const PERSON_CATALOG = [
  {
    slug: "akio-toyoda",
    canonicalName: "Akio Toyoda",
    aliases: ["akio toyoda", "豊田章男", "丰田章男"],
    countryCode: "JP",
    roleCategory: "FOUNDER_EXECUTIVE",
    priority: 1,
    associations: [
      {
        brand: "Toyota",
        series: "GR",
        model: null,
        relationType: "EXECUTIVE",
        confidence: 1
      },
      {
        brand: "Lexus",
        series: null,
        model: null,
        relationType: "EXECUTIVE",
        confidence: 0.9
      }
    ]
  },
  {
    slug: "lei-jun",
    canonicalName: "Lei Jun",
    aliases: ["lei jun", "雷军", "雷軍"],
    countryCode: "CN",
    roleCategory: "FOUNDER_EXECUTIVE",
    priority: 1,
    associations: [
      {
        brand: "Xiaomi",
        series: "SU7",
        model: null,
        relationType: "FOUNDER",
        confidence: 1
      }
    ]
  },
  {
    slug: "elon-musk",
    canonicalName: "Elon Musk",
    aliases: ["elon musk", "馬斯克", "马斯克"],
    countryCode: "US",
    roleCategory: "FOUNDER_EXECUTIVE",
    priority: 1,
    associations: [
      {
        brand: "Tesla",
        series: null,
        model: null,
        relationType: "FOUNDER",
        confidence: 1
      }
    ]
  },
  {
    slug: "mate-rimac",
    canonicalName: "Mate Rimac",
    aliases: ["mate rimac"],
    countryCode: "HR",
    roleCategory: "FOUNDER_EXECUTIVE",
    priority: 1,
    associations: [
      {
        brand: "Rimac",
        series: null,
        model: null,
        relationType: "FOUNDER",
        confidence: 1
      },
      {
        brand: "Bugatti",
        series: null,
        model: null,
        relationType: "EXECUTIVE",
        confidence: 0.9
      }
    ]
  },
  {
    slug: "christian-von-koenigsegg",
    canonicalName: "Christian von Koenigsegg",
    aliases: [
      "christian von koenigsegg",
      "christian koenigsegg"
    ],
    countryCode: "SE",
    roleCategory: "FOUNDER_EXECUTIVE",
    priority: 1,
    associations: [
      {
        brand: "Koenigsegg",
        series: null,
        model: null,
        relationType: "FOUNDER",
        confidence: 1
      }
    ]
  },
  {
    slug: "horacio-pagani",
    canonicalName: "Horacio Pagani",
    aliases: ["horacio pagani"],
    countryCode: "IT",
    roleCategory: "FOUNDER_EXECUTIVE",
    priority: 1,
    associations: [
      {
        brand: "Pagani",
        series: null,
        model: null,
        relationType: "FOUNDER",
        confidence: 1
      }
    ]
  },
  {
    slug: "gordon-murray",
    canonicalName: "Gordon Murray",
    aliases: ["gordon murray"],
    countryCode: "GB",
    roleCategory: "ENGINEER_DESIGNER",
    priority: 1,
    associations: [
      {
        brand: "Gordon Murray Automotive",
        series: null,
        model: null,
        relationType: "FOUNDER",
        confidence: 1
      },
      {
        brand: "McLaren",
        series: null,
        model: "F1",
        relationType: "DESIGNER",
        confidence: 0.9
      }
    ]
  },
  {
    slug: "enzo-ferrari",
    canonicalName: "Enzo Ferrari",
    aliases: ["enzo ferrari"],
    countryCode: "IT",
    roleCategory: "HISTORICAL_FIGURE",
    priority: 2,
    associations: [
      {
        brand: "Ferrari",
        series: null,
        model: null,
        relationType: "HISTORICAL",
        confidence: 1
      }
    ]
  },
  {
    slug: "ferruccio-lamborghini",
    canonicalName: "Ferruccio Lamborghini",
    aliases: ["ferruccio lamborghini"],
    countryCode: "IT",
    roleCategory: "HISTORICAL_FIGURE",
    priority: 2,
    associations: [
      {
        brand: "Lamborghini",
        series: null,
        model: null,
        relationType: "HISTORICAL",
        confidence: 1
      }
    ]
  },
  {
    slug: "ettore-bugatti",
    canonicalName: "Ettore Bugatti",
    aliases: ["ettore bugatti"],
    countryCode: "FR",
    roleCategory: "HISTORICAL_FIGURE",
    priority: 3,
    associations: [
      {
        brand: "Bugatti",
        series: null,
        model: null,
        relationType: "HISTORICAL",
        confidence: 1
      }
    ]
  },
  {
    slug: "carroll-shelby",
    canonicalName: "Carroll Shelby",
    aliases: ["carroll shelby"],
    countryCode: "US",
    roleCategory: "HISTORICAL_FIGURE",
    priority: 2,
    associations: [
      {
        brand: "Ford",
        series: "Mustang",
        model: "Mustang",
        relationType: "BUILDER",
        confidence: 0.95
      },
      {
        brand: "Shelby",
        series: null,
        model: null,
        relationType: "FOUNDER",
        confidence: 1
      }
    ]
  },
  {
    slug: "ken-block",
    canonicalName: "Ken Block",
    aliases: ["ken block"],
    countryCode: "US",
    roleCategory: "DRIVER_RACER",
    priority: 1,
    associations: [
      {
        brand: "Ford",
        series: "Mustang",
        model: "Mustang",
        relationType: "DRIVER",
        confidence: 0.95
      },
      {
        brand: "Hoonigan",
        series: null,
        model: null,
        relationType: "FOUNDER",
        confidence: 1
      }
    ]
  },
  {
    slug: "keiichi-tsuchiya",
    canonicalName: "Keiichi Tsuchiya",
    aliases: [
      "keiichi tsuchiya",
      "土屋圭市",
      "drift king tsuchiya"
    ],
    countryCode: "JP",
    roleCategory: "DRIVER_RACER",
    priority: 2,
    associations: [
      {
        brand: "Toyota",
        series: null,
        model: null,
        relationType: "RACING_DRIVER",
        confidence: 0.8
      },
      {
        brand: "Nissan",
        series: null,
        model: null,
        relationType: "RACING_DRIVER",
        confidence: 0.8
      }
    ]
  },
  {
    slug: "travis-pastrana",
    canonicalName: "Travis Pastrana",
    aliases: ["travis pastrana"],
    countryCode: "US",
    roleCategory: "DRIVER_RACER",
    priority: 2,
    associations: [
      {
        brand: "Subaru",
        series: "WRX",
        model: null,
        relationType: "RACING_DRIVER",
        confidence: 0.9
      },
      {
        brand: "Ford",
        series: null,
        model: null,
        relationType: "DRIVER",
        confidence: 0.7
      }
    ]
  },
  {
    slug: "vaughn-gittin-jr",
    canonicalName: "Vaughn Gittin Jr.",
    aliases: ["vaughn gittin jr", "vaughn gittin"],
    countryCode: "US",
    roleCategory: "DRIVER_RACER",
    priority: 3,
    associations: [
      {
        brand: "Ford",
        series: "Mustang",
        model: "Mustang",
        relationType: "DRIVER",
        confidence: 0.95
      }
    ]
  },
  {
    slug: "magnus-walker",
    canonicalName: "Magnus Walker",
    aliases: ["magnus walker"],
    countryCode: "GB",
    roleCategory: "COLLECTOR_OWNER",
    priority: 2,
    associations: [
      {
        brand: "Porsche",
        series: "911",
        model: null,
        relationType: "OWNER",
        confidence: 0.95
      }
    ]
  },
  {
    slug: "jay-leno",
    canonicalName: "Jay Leno",
    aliases: ["jay leno"],
    countryCode: "US",
    roleCategory: "COLLECTOR_OWNER",
    priority: 2,
    associations: [
      {
        brand: "McLaren",
        series: null,
        model: null,
        relationType: "OWNER",
        confidence: 0.8
      },
      {
        brand: "Chevrolet",
        series: "Corvette",
        model: null,
        relationType: "OWNER",
        confidence: 0.7
      }
    ]
  },
  {
    slug: "doug-demuro",
    canonicalName: "Doug DeMuro",
    aliases: ["doug demuro"],
    countryCode: "US",
    roleCategory: "CREATOR_MEDIA",
    priority: 2,
    associations: [
      {
        brand: "Ford",
        series: null,
        model: null,
        relationType: "CREATOR",
        confidence: 0.6
      },
      {
        brand: "Porsche",
        series: null,
        model: null,
        relationType: "CREATOR",
        confidence: 0.6
      }
    ]
  },
  {
    slug: "mat-watson",
    canonicalName: "Mat Watson",
    aliases: ["mat watson", "matt watson carwow"],
    countryCode: "GB",
    roleCategory: "CREATOR_MEDIA",
    priority: 3,
    associations: [
      {
        brand: "Audi",
        series: null,
        model: null,
        relationType: "CREATOR",
        confidence: 0.5
      },
      {
        brand: "Tesla",
        series: null,
        model: null,
        relationType: "CREATOR",
        confidence: 0.5
      }
    ]
  },
  {
    slug: "chris-harris",
    canonicalName: "Chris Harris",
    aliases: ["chris harris on cars", "chris harris top gear"],
    countryCode: "GB",
    roleCategory: "CREATOR_MEDIA",
    priority: 3,
    associations: [
      {
        brand: "Porsche",
        series: null,
        model: null,
        relationType: "CREATOR",
        confidence: 0.5
      },
      {
        brand: "Ferrari",
        series: null,
        model: null,
        relationType: "CREATOR",
        confidence: 0.5
      }
    ]
  }
];

function containsCjk(value) {
  return /[぀-ヿ㐀-䶿一-鿿豈-﫿]/u.test(
    String(value || "")
  );
}

function validatePersonCatalog(catalog = PERSON_CATALOG) {
  const slugs = new Set();

  for (const person of catalog) {
    if (!person.slug || !person.canonicalName) {
      throw new Error(
        "Every catalog person needs a slug and canonical name."
      );
    }

    if (slugs.has(person.slug)) {
      throw new Error(
        `Duplicate catalog slug "${person.slug}".`
      );
    }

    slugs.add(person.slug);

    if (!PERSON_ROLES.includes(person.roleCategory)) {
      throw new Error(
        `Unknown role "${person.roleCategory}" on ${person.slug}.`
      );
    }

    if (
      !Array.isArray(person.aliases) ||
      person.aliases.length === 0
    ) {
      throw new Error(
        `Catalog person ${person.slug} needs at least one alias.`
      );
    }

    for (const alias of person.aliases) {
      if (alias !== alias.toLowerCase()) {
        throw new Error(
          `Alias "${alias}" on ${person.slug} must be lowercase.`
        );
      }

      if (BANNED_PERSON_ALIASES.has(alias)) {
        throw new Error(
          `Banned person alias "${alias}" on ${person.slug}.`
        );
      }

      if (alias.trim().length < 2) {
        throw new Error(
          `Alias "${alias}" on ${person.slug} is too short.`
        );
      }

      // Latin aliases must be full multi-token names; a
      // single Latin token is never a safe person alias.
      // CJK names are exempt (they carry no spaces).
      if (
        !containsCjk(alias) &&
        !alias.trim().includes(" ")
      ) {
        throw new Error(
          `Alias "${alias}" on ${person.slug} must be a full multi-token name.`
        );
      }
    }

    if (
      !Array.isArray(person.associations) ||
      person.associations.length === 0
    ) {
      throw new Error(
        `Catalog person ${person.slug} needs at least one vehicle association.`
      );
    }

    for (const association of person.associations) {
      if (!association.brand) {
        throw new Error(
          `Association without a brand on ${person.slug}.`
        );
      }

      if (
        !RELATION_TYPES.includes(association.relationType)
      ) {
        throw new Error(
          `Unknown relation "${association.relationType}" on ${person.slug}.`
        );
      }

      const confidence = Number(association.confidence);

      if (
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1
      ) {
        throw new Error(
          `Association confidence out of range on ${person.slug}.`
        );
      }
    }
  }

  return true;
}

validatePersonCatalog();

module.exports = {
  BANNED_PERSON_ALIASES,
  CATALOG_VERSION,
  LINK_METHODS,
  PERSON_CATALOG,
  PERSON_ROLES,
  RELATION_TYPES,
  containsCjk,
  validatePersonCatalog
};
