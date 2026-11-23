"use server";

import { revalidatePath } from "next/cache";
import { moderateShop } from "@/lib/admin";
import { adminPath, currentAdmin } from "@/lib/admin-auth";
import { HttpError } from "@/lib/http";
import { id } from "@/lib/validation";

export async function changeShopStatus(_previousError: string, form: FormData) {
  if (!await currentAdmin()) return "Your admin session has expired. Sign in again.";
  const shopId = id.safeParse(form.get("shopId"));
  const command = form.get("command");
  if (!shopId.success || (command !== "hold" && command !== "resume" && command !== "delete")) {
    return "Select a valid shop and action.";
  }
  try {
    await moderateShop(shopId.data, command);
  } catch (error) {
    if (error instanceof HttpError) return error.message;
    console.error(error);
    return "The shop status could not be updated. Try again.";
  }
  revalidatePath(adminPath);
  return "";
}
