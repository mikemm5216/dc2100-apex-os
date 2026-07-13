// =========================================================
// PERSON CATALOG — Task 3.3E / 3.3E.1
//
// Compact high-precision catalog of PUBLIC automotive
// figures with durable vehicle associations. High precision
// beats coverage: every alias must be a full public name
// (or an unambiguous multi-token nickname / CJK name), so
// generic single tokens like "block", "musk", "jun", or
// "ford" are banned and can never match.
//
// Task 3.3E.1 adds Historical Resonance metadata to every
// association: an evidence horizon (ONE_YEAR / TEN_YEARS /
// ALL_TIME), iconic and legacy flags, a recognition weight,
// optional association years, and a short public resonance
// label. This is curated relationship knowledge — never
// historical traffic and never a view count.
//
// Privacy: the catalog stores only public professional
// identity data — never addresses, contacts, family, or
// any private information.
// =========================================================

const { EVIDENCE_HORIZONS } = require("./resonance");

const CATALOG_VERSION = "vehicle-person-catalog-v1";

const RESONANCE_CATALOG_VERSION =
  "vehicle-person-resonance-v1";

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

const MAX_RESONANCE_LABEL_LENGTH = 240;

const ASSOCIATION_YEAR_RANGE = {
  MIN: 1880,
  MAX: 2100
};

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
        confidence: 1,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.9,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Akio Toyoda is publicly identified with Toyota's GR performance program as its long-time champion."
      },
      {
        brand: "Lexus",
        series: null,
        model: null,
        relationType: "EXECUTIVE",
        confidence: 0.9,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.7,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Akio Toyoda has steered Lexus brand direction as Toyota group chief."
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
        confidence: 1,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.9,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Lei Jun fronts Xiaomi's SU7 electric car program as founder."
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
        confidence: 1,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: true,
        legacyAssociation: false,
        recognitionWeight: 1,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Elon Musk is globally identified with Tesla as its public face."
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
        confidence: 1,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.8,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Mate Rimac founded Rimac and fronts its electric hypercars."
      },
      {
        brand: "Bugatti",
        series: null,
        model: null,
        relationType: "EXECUTIVE",
        confidence: 0.9,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.7,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Mate Rimac leads Bugatti Rimac as chief executive."
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
        confidence: 1,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.8,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Christian von Koenigsegg fronts Koenigsegg's record-chasing hypercars."
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
        confidence: 1,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.8,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Horacio Pagani is the namesake founder and designer of Pagani hypercars."
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
        confidence: 1,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.8,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Gordon Murray designs and builds the GMA T.50 through his own company."
      },
      {
        brand: "McLaren",
        series: null,
        model: "F1",
        relationType: "DESIGNER",
        confidence: 0.9,

        evidenceHorizon: "ALL_TIME",
        iconicAssociation: true,
        legacyAssociation: true,
        recognitionWeight: 1,
        associationStartYear: 1992,
        associationEndYear: null,
        resonanceLabel:
          "Gordon Murray designed the McLaren F1, an enduring supercar benchmark."
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
        confidence: 1,

        evidenceHorizon: "ALL_TIME",
        iconicAssociation: true,
        legacyAssociation: true,
        recognitionWeight: 1,
        associationStartYear: 1947,
        associationEndYear: null,
        resonanceLabel:
          "Enzo Ferrari founded Ferrari and remains its defining historical figure."
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
        confidence: 1,

        evidenceHorizon: "ALL_TIME",
        iconicAssociation: true,
        legacyAssociation: true,
        recognitionWeight: 1,
        associationStartYear: 1963,
        associationEndYear: null,
        resonanceLabel:
          "Ferruccio Lamborghini founded Lamborghini as a direct rival to Ferrari."
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
        confidence: 1,

        evidenceHorizon: "ALL_TIME",
        iconicAssociation: true,
        legacyAssociation: true,
        recognitionWeight: 0.9,
        associationStartYear: 1909,
        associationEndYear: null,
        resonanceLabel:
          "Ettore Bugatti founded Bugatti and shaped its early grand-prix era."
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
        confidence: 0.95,

        evidenceHorizon: "ALL_TIME",
        iconicAssociation: true,
        legacyAssociation: true,
        recognitionWeight: 1,
        associationStartYear: 1965,
        associationEndYear: null,
        resonanceLabel:
          "Carroll Shelby is an enduring Mustang and Shelby performance icon."
      },
      {
        brand: "Shelby",
        series: null,
        model: null,
        relationType: "FOUNDER",
        confidence: 1,

        evidenceHorizon: "ALL_TIME",
        iconicAssociation: true,
        legacyAssociation: true,
        recognitionWeight: 1,
        associationStartYear: 1962,
        associationEndYear: null,
        resonanceLabel:
          "Carroll Shelby founded Shelby American and its Cobra lineage."
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
        confidence: 0.95,

        evidenceHorizon: "TEN_YEARS",
        iconicAssociation: true,
        legacyAssociation: true,
        recognitionWeight: 1,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Ken Block's Gymkhana Ford Mustang builds remain widely recognized."
      },
      {
        brand: "Hoonigan",
        series: null,
        model: null,
        relationType: "FOUNDER",
        confidence: 1,

        evidenceHorizon: "TEN_YEARS",
        iconicAssociation: true,
        legacyAssociation: true,
        recognitionWeight: 0.9,
        associationStartYear: 2010,
        associationEndYear: null,
        resonanceLabel:
          "Ken Block co-founded Hoonigan and defined its car-culture brand."
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
        confidence: 0.8,

        evidenceHorizon: "TEN_YEARS",
        iconicAssociation: true,
        legacyAssociation: true,
        recognitionWeight: 0.9,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Keiichi Tsuchiya, the Drift King, is tied to Toyota AE86 drift culture."
      },
      {
        brand: "Nissan",
        series: null,
        model: null,
        relationType: "RACING_DRIVER",
        confidence: 0.8,

        evidenceHorizon: "TEN_YEARS",
        iconicAssociation: false,
        legacyAssociation: true,
        recognitionWeight: 0.8,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Keiichi Tsuchiya raced and drifted Nissan machinery across his career."
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
        confidence: 0.9,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.8,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Travis Pastrana continues to campaign Subaru WRX rally and stunt builds."
      },
      {
        brand: "Ford",
        series: null,
        model: null,
        relationType: "DRIVER",
        confidence: 0.7,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.6,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Travis Pastrana has driven Ford projects including Gymkhana features."
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
        confidence: 0.95,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.8,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Vaughn Gittin Jr. drifts Ford Mustangs in ongoing competition."
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
        confidence: 0.95,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.7,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Magnus Walker is known for his ongoing Porsche 911 collection."
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
        confidence: 0.8,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.7,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Jay Leno's garage prominently features McLaren road cars."
      },
      {
        brand: "Chevrolet",
        series: "Corvette",
        model: null,
        relationType: "OWNER",
        confidence: 0.7,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.6,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Jay Leno regularly showcases Chevrolet Corvettes from his collection."
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
        confidence: 0.6,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.6,
        generalAssociation: true,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Doug DeMuro reviews Ford vehicles across his automotive media channel."
      },
      {
        brand: "Porsche",
        series: null,
        model: null,
        relationType: "CREATOR",
        confidence: 0.6,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.6,
        generalAssociation: true,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Doug DeMuro reviews Porsche vehicles across his automotive media channel."
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
        confidence: 0.5,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.5,
        generalAssociation: true,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Mat Watson features Audi models in Carwow drag races and reviews."
      },
      {
        brand: "Tesla",
        series: null,
        model: null,
        relationType: "CREATOR",
        confidence: 0.5,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.5,
        generalAssociation: true,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Mat Watson features Tesla models in Carwow drag races and reviews."
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
        confidence: 0.5,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.5,
        generalAssociation: true,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Chris Harris covers Porsche performance cars in his media work."
      },
      {
        brand: "Ferrari",
        series: null,
        model: null,
        relationType: "CREATOR",
        confidence: 0.5,

        evidenceHorizon: "ONE_YEAR",
        iconicAssociation: false,
        legacyAssociation: false,
        recognitionWeight: 0.5,
        generalAssociation: true,
        associationStartYear: null,
        associationEndYear: null,
        resonanceLabel:
          "Chris Harris covers Ferrari performance cars in his media work."
      }
    ]
  }
];

function containsCjk(value) {
  return /[぀-ヿ㐀-䶿一-鿿豈-﫿]/u.test(
    String(value || "")
  );
}

function validateAssociationYear(value) {
  if (value === null || value === undefined) {
    return true;
  }

  return (
    Number.isInteger(value) &&
    value >= ASSOCIATION_YEAR_RANGE.MIN &&
    value <= ASSOCIATION_YEAR_RANGE.MAX
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

      // --- Historical Resonance metadata (3.3E.1) ---

      if (
        !EVIDENCE_HORIZONS.includes(
          association.evidenceHorizon
        )
      ) {
        throw new Error(
          `Association on ${person.slug} needs an evidence horizon of ONE_YEAR, TEN_YEARS, or ALL_TIME.`
        );
      }

      if (
        typeof association.iconicAssociation !==
          "boolean" ||
        typeof association.legacyAssociation !==
          "boolean"
      ) {
        throw new Error(
          `Iconic and legacy flags on ${person.slug} must be booleans.`
        );
      }

      const recognition = Number(
        association.recognitionWeight
      );

      if (
        !Number.isFinite(recognition) ||
        recognition < 0 ||
        recognition > 1
      ) {
        throw new Error(
          `Recognition weight out of range on ${person.slug}.`
        );
      }

      if (
        typeof association.resonanceLabel !==
          "string" ||
        association.resonanceLabel.trim().length ===
          0 ||
        association.resonanceLabel.length >
          MAX_RESONANCE_LABEL_LENGTH
      ) {
        throw new Error(
          `Resonance label on ${person.slug} must be a short non-empty sentence (max ${MAX_RESONANCE_LABEL_LENGTH} characters).`
        );
      }

      if (
        association.generalAssociation !== undefined &&
        typeof association.generalAssociation !==
          "boolean"
      ) {
        throw new Error(
          `generalAssociation on ${person.slug} must be a boolean when present.`
        );
      }

      if (
        !validateAssociationYear(
          association.associationStartYear
        ) ||
        !validateAssociationYear(
          association.associationEndYear
        )
      ) {
        throw new Error(
          `Association years on ${person.slug} must be null or ${ASSOCIATION_YEAR_RANGE.MIN}-${ASSOCIATION_YEAR_RANGE.MAX}.`
        );
      }

      if (
        association.associationStartYear !== null &&
        association.associationStartYear !==
          undefined &&
        association.associationEndYear !== null &&
        association.associationEndYear !== undefined &&
        association.associationEndYear <
          association.associationStartYear
      ) {
        throw new Error(
          `Association end year precedes start year on ${person.slug}.`
        );
      }
    }
  }

  return true;
}

validatePersonCatalog();

module.exports = {
  ASSOCIATION_YEAR_RANGE,
  BANNED_PERSON_ALIASES,
  CATALOG_VERSION,
  LINK_METHODS,
  MAX_RESONANCE_LABEL_LENGTH,
  PERSON_CATALOG,
  PERSON_ROLES,
  RELATION_TYPES,
  RESONANCE_CATALOG_VERSION,
  containsCjk,
  validatePersonCatalog
};
