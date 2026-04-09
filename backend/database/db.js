const path = require("path");
const sqlite3 = require("sqlite3").verbose();

const IS_VERCEL = process.env.VERCEL === "1" || process.env.VERCEL === "true";
const DB_PATH =
  process.env.SQLITE_PATH ||
  (IS_VERCEL ? path.join("/tmp", "portal_forestal.db") : path.join(__dirname, "portal_forestal.db"));
const db = new sqlite3.Database(DB_PATH);

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) {
        reject(error);
        return;
      }
      resolve({
        lastID: this.lastID,
        changes: this.changes,
      });
    });
  });
}

function get(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(row || null);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(rows || []);
    });
  });
}

module.exports = {
  db,
  run,
  get,
  all,
  DB_PATH,
};
