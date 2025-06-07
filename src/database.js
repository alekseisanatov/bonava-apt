const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '../apartments.db'));

function initDatabase() {
  return new Promise((resolve, reject) => {
    db.run(`
      CREATE TABLE IF NOT EXISTS apartments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        price REAL,
        sqMeters REAL,
        plan TEXT,
        projectName TEXT,
        roomsCount INTEGER,
        imageUrl TEXT,
        floor INTEGER,
        link TEXT,
        status TEXT,
        tag TEXT,
        projectLink TEXT,
        createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `, (err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function saveApartments(apartments) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(`
      INSERT INTO apartments (
        price, sqMeters, plan, projectName, roomsCount, 
        imageUrl, floor, link, status, tag, projectLink
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    apartments.forEach(apartment => {
      stmt.run(
        apartment.price,
        apartment.sqMeters,
        apartment.plan,
        apartment.projectName,
        apartment.roomsCount,
        apartment.imageUrl,
        apartment.floor,
        apartment.link,
        apartment.status,
        apartment.tag,
        apartment.projectLink
      );
    });

    stmt.finalize((err) => {
      if (err) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}

function getApartmentsByRooms(roomsCount) {
  return new Promise((resolve, reject) => {
    db.all(
      'SELECT * FROM apartments WHERE roomsCount = ? ORDER BY createdAt DESC',
      [roomsCount],
      (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      }
    );
  });
}

module.exports = {
  initDatabase,
  saveApartments,
  getApartmentsByRooms
}; 