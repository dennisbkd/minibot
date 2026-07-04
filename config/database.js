
import pgPromise from 'pg-promise'

const pgp = pgPromise({}); 

const db = pgp(process.env.DATABASE_URL);

export function inicializarDB (){
  db.one('SELECT $1 AS value', 123)
  .then((data) => {
    console.log('DATA:', data.value);
  })
  .catch((error) => {
    console.log('ERROR:', error);
  });

}

export default db;