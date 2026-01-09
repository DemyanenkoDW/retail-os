/**
 * RETAIL OS BACKEND - MODULAR VERSION
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Store-ID"
};

// --- СЕРВІСИ БАЗИ ДАНИХ ---
const DBService = {
  async init(db) {
    return await db.batch([
      db.prepare(`CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, login TEXT UNIQUE, password TEXT, store_name TEXT)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS employees (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT, name TEXT, position TEXT, role TEXT)`),
      db.prepare(`CREATE TABLE IF NOT EXISTS inventory (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT, code TEXT, name TEXT, price_buy REAL, price_sell REAL, stock REAL, UNIQUE(store_id, code))`),
      db.prepare(`CREATE TABLE IF NOT EXISTS sales (id INTEGER PRIMARY KEY AUTOINCREMENT, store_id TEXT, receipt_id TEXT, code TEXT, name TEXT, price_buy REAL, price_sell REAL, qty REAL, seller_name TEXT, pay_cash REAL, pay_card REAL, created_at DATETIME)`)
    ]);
  },

 async getDashboardData(db, storeId) {
    const queries = [
      db.prepare("SELECT * FROM inventory WHERE store_id = ?").bind(storeId).all(),
      db.prepare("SELECT * FROM employees WHERE store_id = ?").bind(storeId).all(),
      
      // 1. Список чеків для історії (згрупований)
      db.prepare("SELECT receipt_id, created_at, SUM(price_sell * qty) as total, seller_name FROM sales WHERE store_id = ? GROUP BY receipt_id ORDER BY created_at DESC LIMIT 50").bind(storeId).all(),
      
      // 2. ЦЕ НОВИЙ ЗАПИТ: Деталі всіх товарів для перегляду через "Око"
      db.prepare("SELECT receipt_id, name, qty, price_sell FROM sales WHERE store_id = ? ORDER BY created_at DESC LIMIT 200").bind(storeId).all(),
      
      db.prepare("SELECT date(created_at) as day, COUNT(DISTINCT receipt_id) as count, SUM(price_sell * qty) as revenue, SUM((price_sell - price_buy) * qty) as profit FROM sales WHERE store_id = ? GROUP BY day ORDER BY day DESC").bind(storeId).all(),
      db.prepare("SELECT seller_name, COUNT(DISTINCT receipt_id) as count, SUM(price_sell * qty) as revenue, SUM((price_sell - price_buy) * qty) as profit FROM sales WHERE store_id = ? GROUP BY seller_name").bind(storeId).all()
    ];
    
    // Додаємо деталі в результати (details)
    const [inv, emp, sales, details, reps, stats] = await Promise.all(queries);
    
    return { 
      inventory: inv.results, 
      employees: emp.results, 
      salesList: sales.results, 
      salesDetails: details.results, // <--- Тепер фронтенд отримає список товарів
      reports: reps.results, 
      sellerStats: stats.results 
    };
  }
};

// --- ГОЛОВНИЙ ОБРОБНИК ---
export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    await DBService.init(env.DB);
    const storeId = request.headers.get('X-Store-ID');
    const url = new URL(request.url);

    // ОБРОБКА GET ЗАПИТІВ
    if (request.method === "GET") {
      if (!storeId) return Response.json({ error: "Unauthorized" }, { status: 401, headers: corsHeaders });
      const data = await DBService.getDashboardData(env.DB, storeId);
      return Response.json(data, { headers: corsHeaders });
    }

    // ОБРОБКА POST ЗАПИТІВ
    if (request.method === "POST") {
      const body = await request.json();
      const action = body.action;

      // Логіка реєстрації та входу (без storeId)
      if (action === "register") {
        const uid = crypto.randomUUID();
        await env.DB.prepare("INSERT INTO users (id, login, password, store_name) VALUES (?, ?, ?, ?)").bind(uid, body.login, body.password, body.storeName).run();
        await env.DB.prepare("INSERT INTO employees (store_id, name, position, role) VALUES (?, 'Власник', 'Директор', 'admin')").bind(uid).run();
        return Response.json({ user: { storeId: uid, storeName: body.storeName } }, { headers: corsHeaders });
      }

      if (action === "login") {
        const user = await env.DB.prepare("SELECT * FROM users WHERE login = ? AND password = ?").bind(body.login, body.password).first();
        if (!user) return Response.json({ error: "Невірні дані" }, { headers: corsHeaders });
        return Response.json({ user: { storeId: user.id, storeName: user.store_name } }, { headers: corsHeaders });
      }

      // Перевірка авторизації для всіх інших дій
      const sId = body.storeId || storeId;
      if (!sId) return Response.json({ error: "Forbidden" }, { status: 403, headers: corsHeaders });

      // Роутер дій
      switch (action) {
        case "add_employee":
          await env.DB.prepare("INSERT INTO employees (store_id, name, position, role) VALUES (?, ?, ?, ?)").bind(sId, body.name, body.position, body.role || 'user').run();
          break;
        
        case "edit_employee":
          await env.DB.prepare("UPDATE employees SET name=?, position=? WHERE id=? AND store_id=?").bind(body.name, body.position, body.id, sId).run();
          break;

        case "receive":
  // Професійна перевірка на дублікат
  const existing = await env.DB.prepare("SELECT id FROM inventory WHERE store_id = ? AND code = ?")
    .bind(sId, body.code).first();
  
  if (existing) {
    return Response.json({ error: "Товар з таким кодом вже існує у вашому магазині" }, { status: 400, headers: corsHeaders });
  }

  await env.DB.prepare("INSERT INTO inventory (store_id, code, name, price_buy, price_sell, stock) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(sId, body.code, body.name, body.buy, body.sell, body.qty).run();
  break;

        case "edit_item":
          await env.DB.prepare("UPDATE inventory SET code=?, name=?, price_buy=?, price_sell=?, stock=? WHERE id=? AND store_id=?").bind(body.code, body.name, body.buy, body.sell, body.qty, body.id, sId).run();
          break;

        case "checkout":
          const rid = `REC-${Date.now()}`; // Професійна генерація ID
          const batch = body.cart.flatMap(item => [
            env.DB.prepare("UPDATE inventory SET stock = stock - ? WHERE store_id = ? AND code = ?").bind(item.qty, sId, item.code),
            env.DB.prepare("INSERT INTO sales (store_id, receipt_id, code, name, price_buy, price_sell, qty, seller_name, pay_cash, pay_card, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))").bind(sId, rid, item.code, item.name, item.price_buy, item.price_sell, item.qty, body.sellerName, body.payCash, body.payCard)
          ]);
          await env.DB.batch(batch);
          return Response.json({ success: true, receiptId: rid }, { headers: corsHeaders });
      }

      return Response.json({ success: true }, { headers: corsHeaders });
    }
  } catch (err) {
    console.error(err);
    return Response.json({ error: err.message }, { status: 500, headers: corsHeaders });
  }
}