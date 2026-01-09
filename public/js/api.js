const API = {
    async request(action, method = 'POST', data = null, storeId = null) {
        const headers = { 'Content-Type': 'application/json' };
        if (storeId) headers['X-Store-ID'] = storeId;

        const options = { method, headers };
        
        // Якщо це GET запит
        if (method === 'GET') {
            const url = `/api/shop?action=${action}${data?.id ? '&id='+data.id : ''}`;
            const response = await fetch(url, { headers });
            return await response.json();
        }

        // Якщо це POST запит
        options.body = JSON.stringify({ action, ...data });
        const response = await fetch('/api/shop', options);
        return await response.json();
    }
};