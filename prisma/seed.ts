import "dotenv/config";
import { db } from "../lib/db.ts";
import { passwordHash } from "../lib/password.ts";
import type { Prisma } from "../generated/prisma/client.ts";

const items = [
  {
    "id": "carhartt-detroit",
    "title": "Carhartt Detroit Work Jacket",
    "brand": "Carhartt",
    "category": "Jacket",
    "price": "249.00",
    "pitInches": 24,
    "lengthInches": 26,
    "conditionGrade": "VINTAGE_FADE",
    "conditionNotes": "Faded brown duck canvas. The cuffs and hem show wear from regular use.",
    "flawPins": [
      {
        "x": 68,
        "y": 76,
        "note": "Light fraying at right cuff."
      },
      {
        "x": 44,
        "y": 35,
        "note": "Small abrasion beside the chest pocket."
      }
    ],
    "images": [
      "/sample/carhartt-detroit-front.svg",
      "/sample/carhartt-detroit-back.svg",
      "/sample/carhartt-detroit-tag.svg"
    ]
  },
  {
    "id": "single-stitch-wolves",
    "title": "90s Wolf Single-Stitch Tee",
    "brand": "Fruit of the Loom",
    "category": "Tee",
    "price": "85.00",
    "pitInches": 21,
    "lengthInches": 28,
    "conditionGrade": "VINTAGE_FADE",
    "conditionNotes": "Soft charcoal cotton with a gently cracked woodland print.",
    "flawPins": [
      {
        "x": 51,
        "y": 78,
        "note": "Minor pinhole near lower front hem."
      }
    ],
    "images": [
      "/sample/single-stitch-wolves-front.svg",
      "/sample/single-stitch-wolves-back.svg",
      "/sample/single-stitch-wolves-tag.svg"
    ]
  },
  {
    "id": "japanese-flannel",
    "title": "Japanese Brushed Flannel Shirt",
    "brand": "Big Mac",
    "category": "Shirt",
    "price": "68.00",
    "pitInches": 22,
    "lengthInches": 28.5,
    "conditionGrade": "LIKE_NEW",
    "conditionNotes": "Heavy brushed flannel with a boxy cut and intact buttons.",
    "flawPins": [
      {
        "x": 60,
        "y": 58,
        "note": "Very light fabric irregularity near the pocket."
      }
    ],
    "images": [
      "/sample/japanese-flannel-front.svg",
      "/sample/japanese-flannel-back.svg",
      "/sample/japanese-flannel-tag.svg"
    ]
  },
  {
    "id": "dickies-874",
    "title": "Dickies 874 Original Fit",
    "brand": "Dickies",
    "category": "Pants",
    "price": "92.00",
    "pitInches": 16,
    "lengthInches": 40,
    "conditionGrade": "LIKE_NEW",
    "conditionNotes": "Measurements are flat waist × outseam for this pair. Deep charcoal twill with a clean hem.",
    "flawPins": [
      {
        "x": 60,
        "y": 83,
        "note": "Slight press line at the bottom hem."
      }
    ],
    "images": [
      "/sample/dickies-874-front.svg",
      "/sample/dickies-874-back.svg",
      "/sample/dickies-874-tag.svg"
    ]
  },
  {
    "id": "racing-tee",
    "title": "90s Speedway Single-Stitch Tee",
    "brand": "Hanes",
    "category": "Tee",
    "price": "110.00",
    "pitInches": 22,
    "lengthInches": 29,
    "conditionGrade": "DISTRESSED",
    "conditionNotes": "Faded cream cotton with soft cracking across the racing print.",
    "flawPins": [
      {
        "x": 38,
        "y": 63,
        "note": "Small repaired split beside the print."
      }
    ],
    "images": [
      "/sample/racing-tee-front.svg",
      "/sample/racing-tee-back.svg",
      "/sample/racing-tee-tag.svg"
    ]
  },
  {
    "id": "carhartt-chore",
    "title": "Carhartt Blanket-Lined Chore Coat",
    "brand": "Carhartt",
    "category": "Jacket",
    "price": "285.00",
    "pitInches": 25,
    "lengthInches": 29,
    "conditionGrade": "VINTAGE_FADE",
    "conditionNotes": "Olive duck canvas and blanket lining, with even sun fade.",
    "flawPins": [
      {
        "x": 36,
        "y": 67,
        "note": "Faint mark beside the lower patch pocket."
      }
    ],
    "images": [
      "/sample/carhartt-chore-front.svg",
      "/sample/carhartt-chore-back.svg",
      "/sample/carhartt-chore-tag.svg"
    ]
  },
  {
    "id": "cotton-crew",
    "title": "Heavyweight Reverse Weave Crew",
    "brand": "Champion",
    "category": "Sweatshirt",
    "price": "125.00",
    "pitInches": 23.5,
    "lengthInches": 27,
    "conditionGrade": "LIKE_NEW",
    "conditionNotes": "Brushed lining and a wide ribbed hem. Heather grey with a small stitched mark.",
    "flawPins": [],
    "images": [
      "/sample/cotton-crew-front.svg",
      "/sample/cotton-crew-back.svg",
      "/sample/cotton-crew-tag.svg"
    ]
  },
  {
    "id": "japanese-oxford",
    "title": "Japanese Indigo Oxford Shirt",
    "brand": "Uniqlo",
    "category": "Shirt",
    "price": "58.00",
    "pitInches": 20.5,
    "lengthInches": 27.5,
    "conditionGrade": "DEADSTOCK",
    "conditionNotes": "Unworn charcoal-blue cotton oxford with a button-down collar.",
    "flawPins": [],
    "images": [
      "/sample/japanese-oxford-front.svg",
      "/sample/japanese-oxford-back.svg",
      "/sample/japanese-oxford-tag.svg"
    ]
  }
] satisfies Omit<Prisma.GarmentUncheckedCreateInput, "sellerId" | "code">[];

async function main() {
  const password = process.env.SEED_SELLER_PASSWORD;
  if (!password || password.length < 12 || password.startsWith("replace-with-")) {
    throw new Error("Set SEED_SELLER_PASSWORD to a unique password of at least 12 characters.");
  }
  await db().$transaction(async tx => {
    const seller = await tx.seller.upsert({
      where: { storeSlug: "kedaibundle.kl" },
      update: {},
      create: {
        storeSlug: "kedaibundle.kl", storeName: "Kedai Bundle KL",
        bio: "Handpicked vintage, workwear and everyday staples from Kuala Lumpur.",
        whatsappNumber: "60123456789", passwordHash: passwordHash(password),
        qrCodeUrl: "/sample/duitnow.svg", qrAccountName: "KEDAI BUNDLE KL ENTERPRISE",
        qrBankLabel: "Maybank MAE / DuitNow QR", nextItemNumber: 9,
      },
    });
    const drop = await tx.drop.upsert({
      where: { id: "kl-weekend-drop" }, update: {},
      create: { id: "kl-weekend-drop", sellerId: seller.id, title: "The Weekend Edit", scheduledAt: new Date(), status: "LIVE" },
    });
    for (const [index, item] of items.entries()) {
      const code = `B-${String(index + 1).padStart(3, "0")}`;
      await tx.garment.upsert({
        where: { sellerId_code: { sellerId: seller.id, code } }, update: {},
        create: { ...item, sellerId: seller.id, dropId: drop.id, code },
      });
    }
  });
  console.log("Seeded Kedai Bundle KL and eight unique pieces.");
}

main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db().$disconnect());
