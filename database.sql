-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Products table
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    mg_per_ml INTEGER,
    price DECIMAL(10,2) NOT NULL,
    category TEXT,
    type TEXT DEFAULT 'vial',
    active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Orders table
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_number TEXT UNIQUE NOT NULL,
    customer_name TEXT NOT NULL,
    facebook_name TEXT,
    customer_email TEXT NOT NULL,
    customer_phone TEXT NOT NULL,
    delivery_address TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    total_amount DECIMAL(10,2) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    paid_at TIMESTAMP
);

-- Order items table
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    product_code TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity INTEGER NOT NULL,
    price_each DECIMAL(10,2) NOT NULL,
    subtotal DECIMAL(10,2) NOT NULL
);

-- Reviews table
CREATE TABLE reviews (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    customer_name TEXT NOT NULL,
    rating INTEGER CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    product_id UUID REFERENCES products(id),
    approved BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Insert your products
INSERT INTO products (name, code, mg_per_ml, price, category, type) VALUES
('Tirzepatide 15mg', 'TIRZ-15', 15, 299.99, 'weight_loss', 'vial'),
('Tirzepatide 30mg', 'TIRZ-30', 30, 499.99, 'weight_loss', 'vial'),
('Retatrutide 15mg', 'RETA-15', 15, 349.99, 'weight_loss', 'vial'),
('Retatrutide 30mg', 'RETA-30', 30, 549.99, 'weight_loss', 'vial'),
('GHK-Cu 100mg', 'GHK-100', 100, 199.99, 'muscle_building', 'vial'),
('BPC-157 5mg', 'BPC-5', 5, 89.99, 'healing', 'vial');
