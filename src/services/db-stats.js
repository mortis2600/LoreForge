import 'dotenv/config';
import connectDB from '../db.js';
import Character from '../models/Character.js';
import Achievement from '../models/Achievement.js';
import Item from '../models/Item.js';
import Spell from '../models/Spell.js';

async function auditDatabase() {
  await connectDB();
  
  console.log('\n======================================');
  console.log(' DCC API DATABASE AUDIT');
  console.log('======================================');

  try {
    const charCount = await Character.countDocuments();
    const achCount = await Achievement.countDocuments();
    const itemCount = await Item.countDocuments();
    const spellCount = await Spell.countDocuments();

    console.log(` Characters:   ${charCount}`);
    console.log(` Achievements: ${achCount}`);
    console.log(` Loot / Items: ${itemCount}`);
    console.log(` Spells:       ${spellCount}`);
    console.log('======================================\n');
    
  } catch (error) {
    console.error('Audit failed:', error.message);
  } finally {
    process.exit(0);
  }
}

auditDatabase();
