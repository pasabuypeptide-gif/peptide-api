const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Your Google Sheet ID and API key
const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const API_KEY = process.env.GOOGLE_API_KEY;

async function migrate() {
  try {
    console.log('Starting migration...');
    
    // Fetch data from Google Sheets
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${SHEET_ID}/values/Orders?key=${API_KEY}`);
    const data = await response.json();
    
    if (!data.values || data.values.length === 0) {
      console.log('No data found in sheet');
      return;
    }
    
    const rows = data.values;
    const headers = rows[0];
    console.log(`Found ${rows.length - 1} orders to migrate`);
    
    // Migrate each row
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const orderData = {};
      
      headers.forEach((header, index) => {
        orderData[header.toLowerCase().replace(/\s+/g, '_')] = row[index] || '';
      });
      
      // Skip if already migrated (check by order_id)
      const existing = await pool.query('SELECT id FROM orders WHERE order_number = $1', [orderData.order_id]);
      if (existing.rows.length > 0) {
        console.log(`Skipping ${orderData.order_id} - already exists`);
        continue;
      }
      
      // Parse items if they exist
      let items = [];
      try {
        if (orderData.items) {
          items = JSON.parse(orderData.items);
        }
      } catch (e) {
        console.log(`Could not parse items for ${orderData.order_id}`);
      }
      
      // Insert order
      const orderResult = await pool.query(
        `INSERT INTO orders (order_number, customer_name, facebook_name, customer_email, customer_phone, delivery_address, total_amount, status, notes, created_at) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
         RETURNING id`,
        [
          orderData.order_id || `MIGRATED-${i}`,
          orderData.customer_name || 'Unknown',
          orderData.facebook_name || '',
          orderData.email || 'unknown@email.com',
          orderData.phone || '',
          orderData.address || '',
          parseFloat(orderData.total) || 0,
          (orderData.payment_status || 'UNPAID').toLowerCase(),
          orderData.notes || '',
          orderData.timestamp ? new Date(orderData.timestamp) : new Date()
        ]
      );
      
      const orderId = orderResult.rows[0].id;
      
      // Insert order items
      if (items.length > 0) {
        for (const item of items) {
          await pool.query(
            `INSERT INTO order_items (order_id, product_code, product_name, quantity, price_each, subtotal) 
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              orderId,
              item.code || item.productId || 'UNKNOWN',
              item.name || item.product || 'Unknown Product',
              item.qty || item.quantity || 1,
              item.price || 0,
              (item.qty || item.quantity || 1) * (item.price || 0)
            ]
          );
        }
      }
      
      console.log(`Migrated order ${i}: ${orderData.order_id}`);
    }
    
    console.log('Migration complete!');
    process.exit(0);
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  }
}

migrate();
