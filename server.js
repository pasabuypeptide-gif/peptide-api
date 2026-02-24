const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// CONFIG (from your Code.gs)
const CONFIG = {
  BATCH_SIZE: 10,
  PAYMENT_DEADLINE_HOURS: 24
};

// ==================== HELPER FUNCTIONS ====================

// Test connection
app.get('/test', async (req, res) => {
  try {
    const result = await pool.query('SELECT NOW()');
    res.json({ message: 'Database connected!', time: result.rows[0].now });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== PRODUCTS ====================

// Get all products
app.get('/products', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM products WHERE active = true ORDER BY name');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Add product
app.post('/products', async (req, res) => {
  const { name, code, price, type, description, mg_per_ml, category } = req.body;
  try {
    const result = await pool.query(
      'INSERT INTO products (name, code, price, type, description, mg_per_ml, category) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *',
      [name, code, price, type || 'vial', description, mg_per_ml, category]
    );
    res.json({ success: true, product: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update product
app.patch('/products/:id', async (req, res) => {
  const { name, price, active } = req.body;
  try {
    const updates = [];
    const values = [];
    let idx = 1;
    
    if (name) { updates.push(`name = $${idx++}`); values.push(name); }
    if (price) { updates.push(`price = $${idx++}`); values.push(price); }
    if (active !== undefined) { updates.push(`active = $${idx++}`); values.push(active); }
    
    values.push(req.params.id);
    const query = `UPDATE products SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`;
    
    const result = await pool.query(query, values);
    res.json({ success: true, product: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================== ORDERS ====================

// Get all orders with items
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
            'subtotal', oi.subtotal,
            'type', p.type
          )
        ) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
      FROM orders o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      LEFT JOIN products p ON oi.product_code = p.code
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Create new order
app.post('/orders', async (req, res) => {
  const { customer_name, facebook_name, customer_email, customer_phone, delivery_address, items, notes } = req.body;
  
  try {
    // Calculate totals
    let subtotal = 0;
    const hasBoxes = items.some(item => item.type === 'box');
    const pasabuyFee = hasBoxes ? 600 : 0;
    
    items.forEach(item => {
      subtotal += item.price * item.qty;
    });
    
    const totalAmount = subtotal + pasabuyFee;
    
    // Generate order number
    const date = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const count = await pool.query('SELECT COUNT(*) FROM orders WHERE DATE(created_at) = CURRENT_DATE');
    const orderNum = `ORD-${date}-${String(parseInt(count.rows[0].count) + 1).padStart(3, '0')}`;
    
    // Insert order
    const orderResult = await pool.query(
      `INSERT INTO orders (order_number, customer_name, facebook_name, customer_email, customer_phone, delivery_address, subtotal, pasabuy_fee, total_amount, notes, status) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending') 
       RETURNING *`,
      [orderNum, customer_name, facebook_name, customer_email, customer_phone, delivery_address, subtotal, pasabuyFee, totalAmount, notes]
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

// Update order
app.patch('/orders/:id', async (req, res) => {
  const { customer_name, facebook_name, customer_email, customer_phone, delivery_address, status, notes } = req.body;
  
  try {
    const result = await pool.query(
      `UPDATE orders 
       SET customer_name = $1, facebook_name = $2, customer_email = $3, 
           customer_phone = $4, delivery_address = $5, status = $6, notes = $7, updated_at = NOW()
       WHERE id = $8 RETURNING *`,
      [customer_name, facebook_name, customer_email, customer_phone, delivery_address, status, notes, req.params.id]
    );
    
    res.json({ success: true, order: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Record payment
app.post('/orders/:id/pay', async (req, res) => {
  const { amount, method, notes } = req.body;
  
  try {
    // Get current order
    const order = await pool.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (order.rows.length === 0) return res.status(404).json({ error: 'Order not found' });
    
    const currentOrder = order.rows[0];
    const newPaid = (parseFloat(currentOrder.paid_amount) || 0) + parseFloat(amount);
    const total = parseFloat(currentOrder.total_amount);
    const remaining = Math.max(0, total - newPaid);
    const status = remaining <= 0.01 ? 'paid' : 'partial';
    
    // Update order
    const result = await pool.query(
      `UPDATE orders 
       SET paid_amount = $1, remaining_amount = $2, status = $3, paid_at = CASE WHEN $3 = 'paid' THEN NOW() ELSE paid_at END
       WHERE id = $4 RETURNING *`,
      [newPaid, remaining, status, req.params.id]
    );
    
    // Record payment
    await pool.query(
      `INSERT INTO payments (order_id, amount, method, notes) VALUES ($1, $2, $3, $4)`,
      [req.params.id, amount, method || 'manual', notes]
    );
    
    res.json({ success: true, order: result.rows[0], payment: { amount, method, status } });
  } catch (err) {
