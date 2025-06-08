const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, '../apartments.db'));

function initDatabase() {
  console.log('Initializing database...');
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
        console.error('Error creating table:', err);
        reject(err);
      } else {
        console.log('Database table created or already exists');
        resolve();
      }
    });
  });
}

function saveApartments(apartments) {
  console.log(`Attempting to save ${apartments.length} apartments...`);
  return new Promise((resolve, reject) => {
    // First, clear existing data
    db.run('DELETE FROM apartments', (err) => {
      if (err) {
        console.error('Error clearing existing data:', err);
        reject(err);
        return;
      }
      console.log('Cleared existing data');

      const stmt = db.prepare(`
        INSERT INTO apartments (
          price, sqMeters, plan, projectName, roomsCount, 
          imageUrl, floor, link, status, tag, projectLink
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let savedCount = 0;
      let errorCount = 0;

      apartments.forEach(apartment => {
        try {
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
            apartment.projectLink,
            (err) => {
              if (err) {
                console.error('Error saving apartment:', err);
                errorCount++;
              } else {
                savedCount++;
              }
            }
          );
        } catch (error) {
          console.error('Error preparing apartment data:', error);
          errorCount++;
        }
      });

      stmt.finalize((err) => {
        if (err) {
          console.error('Error finalizing statement:', err);
          reject(err);
        } else {
          console.log(`Successfully saved ${savedCount} apartments, ${errorCount} errors`);
          resolve();
        }
      });
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
          console.error('Error getting apartments by rooms:', err);
          reject(err);
        } else {
          console.log(`Found ${rows.length} apartments with ${roomsCount} rooms`);
          resolve(rows);
        }
      }
    );
  });
}

class Database {
  constructor(dbPath) {
    this.db = new sqlite3.Database(dbPath);
  }

  async initialize() {
    return new Promise((resolve, reject) => {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS apartments (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT,
          location TEXT,
          price TEXT,
          area TEXT,
          rooms TEXT,
          floor TEXT,
          url TEXT UNIQUE,
          projectName TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `, (err) => {
        if (err) {
          console.error('Error creating apartments table:', err);
          reject(err);
        } else {
          console.log('Apartments table initialized');
          resolve();
        }
      });
    });
  }

  async saveApartments(apartments) {
    try {
      // First ensure table exists
      await this.initialize();

      // Clear existing data
      await this.run('DELETE FROM apartments');

      const stmt = this.db.prepare(`
        INSERT INTO apartments (
          title, location, price, area, rooms, floor, url, projectName
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      let savedCount = 0;
      let errorCount = 0;

      apartments.forEach(apartment => {
        try {
          stmt.run(
            apartment.title,
            apartment.location,
            apartment.price,
            apartment.area,
            apartment.rooms,
            apartment.floor,
            apartment.url,
            apartment.projectName,
            (err) => {
              if (err) {
                console.error('Error saving apartment:', err);
                errorCount++;
              } else {
                savedCount++;
              }
            }
          );
        } catch (error) {
          console.error('Error preparing apartment data:', error);
          errorCount++;
        }
      });

      stmt.finalize((err) => {
        if (err) {
          console.error('Error finalizing statement:', err);
          reject(err);
        } else {
          console.log(`Successfully saved ${savedCount} apartments, ${errorCount} errors`);
          resolve();
        }
      });
    } catch (error) {
      reject(error);
    }
  }

  getApartmentsByRooms(roomsCount) {
    return new Promise((resolve, reject) => {
      this.db.all(
        'SELECT * FROM apartments WHERE rooms = ? ORDER BY created_at DESC',
        [roomsCount],
        (err, rows) => {
          if (err) {
            console.error('Error getting apartments by rooms:', err);
            reject(err);
          } else {
            console.log(`Found ${rows.length} apartments with ${roomsCount} rooms`);
            resolve(rows);
          }
        }
      );
    });
  }

  run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) {
          reject(err);
        } else {
          resolve(this);
        }
      });
    });
  }
}

module.exports = Database; 