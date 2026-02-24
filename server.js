const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());
app.get('/', (req, res) => {
  res.json({ message: 'Peptide API is running!', status: 'ok' });
});
// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Test database connection
app.get('/test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ message: 'Database connected!', time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all products
app.get('/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE active = true ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new order
app.post('/orders', async (req, res) => {
  const { customer_name, facebook_name, customer_email, customer_phone, delivery_address, items, total, notes } = req.body;
  
  try {
    // Generate order number (ORD-YYYYMMDD-001)
    const date = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const count = await pool.query('SELECT COUNT(*) FROM orders WHERE DATE(created_at) = CURRENT_DATE');
    const orderNum = `ORD-${date}-${String(parseInt(count.rows[0].count) + 1).padStart(3, '0')}`;
    
    // Insert order
    const orderResult = await pool.query(
      `INSERT INTO orders (order_number, customer_name, facebook_name, customer_email, customer_phone, delivery_address, total_amount, notes) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
       RETURNING *`,
      [orderNum, customer_name, facebook_name, customer_email, customer_phone, delivery_address, total, notes]
    );
    
    const orderId = orderResult.rows[0].id;
    
    // Insert order items
    for (const item of items) {
      await pool.query(
        `INSERT INTO order_items (order_id, product_code, product_name, quantity, price_each, subtotal) 
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [orderId, item.code, item.name, item.qty, item.price, item.qty * item.price]
      );
    }
    
    res.json({ success: true, order: orderResult.rows[0] });
  } catch (err) {
    console.error('Order error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all orders (for admin)
app.get('/orders', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, 
        COALESCE(json_agg(
          json_build_object(
            'product_code', oi.product_code,
            'product_name', oi.product_name,
            'quantity', oi.quantity,
            'price_each', oi.price_each,
            'subtotal', oi.subtotal
          )
        ) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get overdue orders (unpaid > 24 hours)
app.get('/orders/overdue', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT * FROM orders 
      WHERE status = 'pending' 
      AND created_at < NOW() - INTERVAL '24 hours'
      ORDER BY created_at ASC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update order status (mark as paid)
app.patch('/orders/:id/pay', async (req, res) => {
  try {
    const result = await pool.query(
      "UPDATE orders SET status = 'paid', paid_at = NOW() WHERE id = $1 RETURNING *",
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get batches info
app.get('/batches', async (req, res) => {
  try {
    // Get all products with their order counts
    const products = await pool.query('SELECT * FROM products WHERE active = true');
    const batchSize = 10; // Your batch size
    
    const batchData = {};
    
    for (const product of products.rows) {
      const count = await pool.query(`
        SELECT COALESCE(SUM(oi.quantity), 0) as filled
        FROM order_items oi
        JOIN orders o ON oi.order_id = o.id
        WHERE oi.product_code = $1 AND o.status != 'cancelled'
      `, [product.code]);
      
      const filled = parseInt(count.rows[0].filled) || 0;
      const currentBatch = Math.floor(filled / batchSize) + 1;
      const filledInCurrent = filled % batchSize;
      
      batchData[product.code] = {
        product: product,
        currentBatch: currentBatch,
        filled: filledInCurrent,
        totalFilled: filled,
        remaining: batchSize - filledInCurrent
      };
    }
    
    res.json({ batchSize, batches: batchData });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reviews endpoints
app.get('/reviews', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*, p.name as product_name
      FROM reviews r
      LEFT JOIN products p ON r.product_id = p.id
      WHERE r.approved = true
      ORDER BY r.created_at DESC
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/reviews', async (req, res) => {
  const { customer_name, rating, comment, product_code } = req.body;
  try {
    await pool.query(
      `INSERT INTO reviews (customer_name, rating, comment, product_id) 
       VALUES ($1, $2, $3, (SELECT id FROM products WHERE code = $4))`,
      [customer_name, rating, comment, product_code]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
