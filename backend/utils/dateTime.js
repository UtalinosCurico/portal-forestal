const CHILE_LOCALE = "es-CL";
const CHILE_TIME_ZONE = "America/Santiago";
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDateValue(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  const text = String(value).trim();
  if (!text) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return new Date(`${text}T12:00:00.000Z`);
  }

  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text)) {
    return new Date(text.replace(" ", "T") + "Z");
  }

  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatParts(date, withTime) {
  const formatter = new Intl.DateTimeFormat(CHILE_LOCALE, {
    timeZone: CHILE_TIME_ZONE,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }
      : {}),
  });

  const parts = formatter.formatToParts(date);
  const pick = (type) => parts.find((item) => item.type === type)?.value || "";
  const dateText = `${pick("day")}-${pick("month")}-${pick("year")}`;

  if (!withTime) {
    return dateText;
  }

  return `${dateText} ${pick("hour")}:${pick("minute")}`;
}

function formatIsoDate(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatSqlDateTime(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function getChileFormatter(withTime = true) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: CHILE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    ...(withTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
        }
      : {}),
  });
}

function getChileNumericParts(date, withTime = true) {
  const formatter = getChileFormatter(withTime);
  const parts = formatter.formatToParts(date);
  const pick = (type) => Number(parts.find((item) => item.type === type)?.value || 0);
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: withTime ? pick("hour") : 0,
    minute: withTime ? pick("minute") : 0,
    second: withTime ? pick("second") : 0,
  };
}

function getTimeZoneOffsetMs(date) {
  const parts = getChileNumericParts(date, true);
  const utcEquivalent = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return utcEquivalent - date.getTime();
}

function zonedDateTimeToUtc(parts) {
  const utcGuess = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0
  );

  let offset = getTimeZoneOffsetMs(new Date(utcGuess));
  let adjusted = utcGuess - offset;

  const adjustedOffset = getTimeZoneOffsetMs(new Date(adjusted));
  if (adjustedOffset !== offset) {
    adjusted = utcGuess - adjustedOffset;
  }

  return new Date(adjusted);
}

function ensureDateKey(dateText) {
  const text = String(dateText || "").trim();
  if (!DATE_KEY_PATTERN.test(text)) {
    throw new Error("dateText must have format YYYY-MM-DD");
  }
  return text;
}

function splitDateKey(dateText) {
  const normalized = ensureDateKey(dateText);
  const [year, month, day] = normalized.split("-").map(Number);
  return { year, month, day };
}

function addDaysToDateKey(dateText, days) {
  const { year, month, day } = splitDateKey(dateText);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return formatIsoDate(date);
}

function formatChileDateKey(value) {
  const date = parseDateValue(value);
  if (!date) {
    return "";
  }

  const parts = getChileNumericParts(date, false);
  return `${String(parts.year).padStart(4, "0")}-${String(parts.month).padStart(2, "0")}-${String(
    parts.day
  ).padStart(2, "0")}`;
}

function getChileDayBounds(dateText) {
  const startParts = splitDateKey(dateText);
  const endDateKey = addDaysToDateKey(dateText, 1);
  const endParts = splitDateKey(endDateKey);

  const startUtc = zonedDateTimeToUtc({
    ...startParts,
    hour: 0,
    minute: 0,
    second: 0,
  });

  const endUtc = zonedDateTimeToUtc({
    ...endParts,
    hour: 0,
    minute: 0,
    second: 0,
  });

  return {
    startUtc,
    endUtc,
    startUtcSql: formatSqlDateTime(startUtc),
    endUtcSql: formatSqlDateTime(endUtc),
  };
}

function formatChileDateTime(value) {
  const date = parseDateValue(value);
  if (!date) {
    return "";
  }

  return formatParts(date, true);
}

function formatChileDate(value) {
  const date = parseDateValue(value);
  if (!date) {
    return "";
  }

  return formatParts(date, false);
}

module.exports = {
  CHILE_LOCALE,
  CHILE_TIME_ZONE,
  parseDateValue,
  addDaysToDateKey,
  formatChileDateKey,
  formatChileDateTime,
  formatChileDate,
  formatSqlDateTime,
  getChileDayBounds,
};
