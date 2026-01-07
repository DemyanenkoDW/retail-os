export async function onRequest(context) {
  const { request, env } = context;

  // 1. ІНІЦІАЛІЗАЦІЯ (Безпечна для Windows)
  // Створюємо таблиці окремо, щоб уникнути помилки 'duration'
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
    // GET: Завантаження даних
    if (request.method === "GET") {
      const inventory = await env.DB.prepare("SELECT * FROM inventory ORDER BY name").all();
      
      // Складна аналітика SQL
      const reports = await env.DB.prepare(`
        SELECT 
          date(created_at) as day, 
          COUNT(*) as count, 
          SUM(price_sell) as revenue, 
          SUM(price_sell - price_buy) as profit 
        FROM sales 
        GROUP BY day 
        ORDER BY day DESC LIMIT 7
      `).all();

      return Response.json({ 
        inventory: inventory.results || [], 
        reports: reports.results || [] 
      });
    }

    // POST: Дії
    if (request.method === "POST") {
      const data = await request.json();

      // --- ПРИЙОМ ТОВАРУ ---
      if (data.action === "receive") {
        console.log(`[LOG] Прийом товару: ${data.name} (+${data.qty})`);
        
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

      // --- ПРОДАЖ (ЧЕК) ---
      if (data.action === "checkout") {
        console.log(`[LOG] Продаж чека: ${data.cart.length} позицій`);
        const receiptId = crypto.randomUUID().split('-')[0];

        // Виконуємо цикл (найстабільніший метод для локальної розробки)
        for (const item of data.cart) {
          // 1. Мінусуємо склад
          await env.DB.prepare("UPDATE inventory SET stock = stock - 1 WHERE code = ?")
            .bind(item.code).run();
          
          // 2. Записуємо в історію
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