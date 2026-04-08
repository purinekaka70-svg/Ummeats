export const firebaseConfig = {
  apiKey: "AIzaSyApi2RjwEXEW2mTwCMiYERKUNAYL8Toddk",
  authDomain: "tamuexpress-26e4a.firebaseapp.com",
  projectId: "tamuexpress-26e4a",
  storageBucket: "tamuexpress-26e4a.appspot.com",
  messagingSenderId: "202068792631",
  appId: "1:202068792631:web:8a9b97028ebd7a45af76b2",
};

export const SERVICE_FEE = 40;
export const STAFF_LOUNGE_SERVICE_FEE = 30;
export const SERVICE_FEE_TILL = "7312380";
export const DISTANCE_SERVICE_FEE_BANDS = [
  { id: "nearby", label: "within 750 m", maxKm: 0.75, surcharge: 0 },
  { id: "walkable", label: "750 m to 1.5 km", maxKm: 1.5, surcharge: 20 },
  { id: "mid", label: "1.5 km to 3 km", maxKm: 3, surcharge: 40 },
  { id: "far", label: "3 km to 5 km", maxKm: 5, surcharge: 70 },
  { id: "extended", label: "over 5 km", maxKm: Number.POSITIVE_INFINITY, surcharge: 110 },
];
export const SUPPORT_CONTACTS = ["0115613332", "0116860686"];
export const ONESIGNAL_APP_ID = "8a058e59-ba58-44ae-a3fb-2f8c53778035";
export const ONESIGNAL_SAFARI_WEB_ID = "web.onesignal.auto.27d2eba6-7621-43e8-b8d4-d2a9de3b8fea";
export const ONESIGNAL_SERVICE_WORKER_PATH = "OneSignalSDKWorker.js";
export const ONESIGNAL_SERVICE_WORKER_SCOPE = "/";
export const SMS_SIMULATION_ENABLED = true;
export const MARKETPLACE_SHOP_HERE_URL = "https://purinekaka70-svg.github.io/feedback.tamu/";
export const SHOP_HERE_URL = "./umma-shop.html";
export const DEFAULT_HOTEL_LOCATION = "Around Umma University";
export const UMMA_SHOP_PAGE_URL = "./umma-shop.html";
export const HOTEL_LOCATION_SUGGESTIONS = [
  DEFAULT_HOTEL_LOCATION,
  "My Qwetu Residence",
  "Kajiado Town",
  "Kajiado CBD",
];

export const ANNOUNCEMENT_TEXT = "Order times: No morning orders | Lunch: 11:30 AM - 2:00 PM | Evening: 4:00 PM - 8:00 PM";

export function getServiceFeeForHotel(hotelOrName) {
  const hotelName = typeof hotelOrName === "string" ? hotelOrName : hotelOrName?.name;
  const normalizedName = String(hotelName || "").trim().replace(/\s+/g, " ").toLowerCase();

  if (/\bstaff\s+(lounge|lodge|loge)\b/.test(normalizedName)) {
    return STAFF_LOUNGE_SERVICE_FEE;
  }

  return SERVICE_FEE;
}

export function resolveDistanceServiceFee(distanceKm, hotelOrName) {
  const baseFee = getServiceFeeForHotel(hotelOrName);

  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return {
      bandId: "base",
      baseFee,
      fee: baseFee,
      label: "Base service fee",
      surcharge: 0,
    };
  }

  const band = DISTANCE_SERVICE_FEE_BANDS.find((item) => distanceKm <= item.maxKm) || DISTANCE_SERVICE_FEE_BANDS.at(-1);

  return {
    bandId: band?.id || "base",
    baseFee,
    fee: baseFee,
    label: band?.label || "Distance-based service fee",
    surcharge: 0,
  };
}
