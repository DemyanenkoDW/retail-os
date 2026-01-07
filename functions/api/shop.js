export async function onRequest(context) {
  const { request, env } = context;

  // 1. ІНІЦІАЛІЗАЦІЯ
  try {
    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS inventory (
        code TEXT PRIMARY KEY,
        name TEXT,
        price_buy REAL,
        price_sell REAL,
        stock INTEGER DEFAULT 0
      )
    `).run();

    await env.DB.prepare(`
      CREATE TABLE IF NOT EXISTS sales (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        receipt_id TEXT,
        code TEXT,
        name TEXT,
        price_buy REAL,
        price_sell REAL,
        created_at DATETIME DEFAULT (datetime('now', 'localtime'))
      )
    `).run();
  } catch (e) {
    console.error("Помилка БД (ініціалізація):", e.message);
  }

  // 2. ОБРОБКА ЗАПИТІВ
  try {
    if (request.method === "GET") {
      const inventory = await env.DB.prepare("SELECT * FROM inventory ORDER BY name").all();
      
      // Агрегація по днях для графіків/таблиці статистики
      const reports = await env.DB.prepare(`
        SELECT 
          date(created_at) as day, 
          COUNT(DISTINCT receipt_id) as count, 
          SUM(price_sell) as revenue, 
          SUM(price_sell - price_buy) as profit 
        FROM sales 
        GROUP BY day 
        ORDER BY day DESC LIMIT 7
      `).all();

      // Список окремих продажів (Історія чеків)
      // Ми групуємо по receipt_id, щоб один чек (кілька товарів) виглядав як одна строка в історії
      const salesList = await env.DB.prepare(`
        SELECT 
          receipt_id as id,
          created_at,
          SUM(price_sell) as price_sell
        FROM sales 
        GROUP BY receipt_id
        ORDER BY created_at DESC LIMIT 50
      `).all();

      return Response.json({ 
        inventory: inventory.results || [], 
        reports: reports.results || [],
        salesList: salesList.results || []
      });
    }

    if (request.method === "POST") {
      const data = await request.json();

      if (data.action === "receive") {
        await env.DB.prepare(`
          INSERT INTO inventory (code, name, price_buy, price_sell, stock)
          VALUES (?1, ?2, ?3, ?4, ?5)
          ON CONFLICT(code) DO UPDATE SET 
            stock = stock + ?5, 
            price_buy = ?3, 
            price_sell = ?4
        `).bind(data.code, data.name, data.buy, data.sell, data.qty).run();

        return Response.json({ success: true });
      }

      if (data.action === "checkout") {
        const receiptId = crypto.randomUUID().split('-')[0];

        for (const item of data.cart) {
          // Зменшуємо залишок
          await env.DB.prepare("UPDATE inventory SET stock = stock - 1 WHERE code = ?")
            .bind(item.code).run();
          
          // Записуємо товар у чек
          await env.DB.prepare(`
            INSERT INTO sales (receipt_id, code, name, price_buy, price_sell) 
            VALUES (?, ?, ?, ?, ?)
          `).bind(receiptId, item.code, item.name, item.price_buy, item.price_sell).run();
        }
        
        return Response.json({ success: true });
      }
    }
    
    return new Response("Method not allowed", { status: 405 });

  } catch (err) {
    console.error("КРИТИЧНА ПОМИЛКА:", err.message);
    return Response.json({ error: err.message }, { status: 500 });
  }
}