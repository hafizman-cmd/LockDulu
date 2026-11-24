export const samplePaymentQr = "/sample/duitnow.svg";

type PaymentSetup = { qrCodeUrl: string; qrAccountName: string; qrBankLabel: string };

export function paymentConfigured({ qrCodeUrl, qrAccountName, qrBankLabel }: PaymentSetup) {
  const sampleAllowed = process.env.NODE_ENV !== "production" && process.env.LOCKDULU_TEST_PAYMENTS === "1";
  return qrAccountName.trim().length >= 2 && qrBankLabel.trim().length >= 2 &&
    (/^\/api\/media\/[a-f0-9-]{36}\.webp$/.test(qrCodeUrl) || sampleAllowed && qrCodeUrl === samplePaymentQr);
}
