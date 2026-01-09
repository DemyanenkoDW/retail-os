function retailApp() {
    return {
        // Стан додатка
        viewingReceipt: null,
        selectedDate: new Date().toISOString().split('T')[0],
        user: JSON.parse(localStorage.getItem('ret_v11')) || null,
        currentTab: 'pos',
        authMode: 'login',
        authForm: { login: '', password: '', storeName: '' },
        
        // Дані з сервера
        inventory: [],
        employees: [],
        salesList: [],
        salesDetails: [],
        reports: [],
        sellerStats: [],

        // Робочий стан
        cart: [],
        search: '',
        currentSeller: '',
        modalOpen: false,
        empModalOpen: false,
        checkoutModalOpen: false,
        
        newItem: { code: '', name: '', buy: 0, sell: 0, qty: 0 },
        editId: null,
        newEmp: { name: '', position: '' },
        editEmpId: null,
        payForm: { cash: 0, card: 0 },
        
        lastReceiptId: '',
        cartToPrint: [],

        async init() {
            if (this.user) await this.fetchData();
        },

        // Геттери
        get filteredInventory() {
            const s = this.search.toLowerCase();
            let items = this.inventory.filter(i => 
                i.name.toLowerCase().includes(s) || i.code.includes(s)
            );

            return items.sort((a, b) => {
                const aStock = a.stock > 0 ? 1 : 0;
                const bStock = b.stock > 0 ? 1 : 0;
                if (aStock !== bStock) return bStock - aStock; 
                return a.name.localeCompare(b.name);
            });
        },

        get filteredSales() {
            return this.salesList.filter(s => {
                const saleDate = s.created_at.split(' ')[0];
                return saleDate === this.selectedDate;
            });
        },

        get cartTotal() { return this.cart.reduce((s, i) => s + (i.price_sell * i.qty), 0); },
        get change() { return (this.payForm.cash + this.payForm.card) - this.cartTotal; },
        
        get isCodeDuplicate() {
            if (this.editId) return false; 
            return this.inventory.some(item => item.code === this.newItem.code && this.newItem.code !== '');
        },

        // Методи
        async auth() {
            const data = await API.request(this.authMode, 'POST', this.authForm);
            if (data.error) return alert(data.error);
            this.user = data.user;
            localStorage.setItem('ret_v11', JSON.stringify(data.user));
            await this.init();
        },

        logout() {
            this.user = null;
            localStorage.removeItem('ret_v11');
        },

        async fetchData() {
            const data = await API.request('get_all', 'GET', null, this.user.storeId);
            this.inventory = data.inventory || [];
            this.employees = data.employees || [];
            this.salesList = data.salesList || [];
            this.salesDetails = data.salesDetails || [];
            this.reports = data.reports || [];
            this.sellerStats = data.sellerStats || [];
            if (!this.currentSeller && this.employees.length) this.currentSeller = this.employees[0].name;
        },

        addToCart(item) {
            if (item.stock <= 0) return alert('Товар закінчився');
            let found = this.cart.find(x => x.code === item.code);
            if (found) {
                if (found.qty < item.stock) found.qty++;
            } else {
                this.cart.push({ ...item, qty: 1 });
            }
        },

        async processCheckout(shouldPrint = false) {
            const datePart = new Date().toISOString().split('T')[0].replace(/-/g, '');
            const randomPart = Math.floor(100 + Math.random() * 900);
            const customId = `${this.user.storeId.substring(0,4)}-${datePart}-${randomPart}`;

            const res = await API.request('checkout', 'POST', {
                storeId: this.user.storeId,
                receiptId: customId,
                cart: this.cart,
                sellerName: this.currentSeller,
                payCash: this.payForm.cash,
                payCard: this.payForm.card
            }, this.user.storeId);
            
            if (res.error) return alert(res.error);

            this.lastReceiptId = res.receiptId;
            this.cartToPrint = [...this.cart];
            this.cart = [];
            this.checkoutModalOpen = false;
            this.payForm = { cash: 0, card: 0 };
            
            await this.fetchData();

            if (shouldPrint) {
                setTimeout(() => window.print(), 500);
            }
        },

        openItemModal(item = null) {
            this.editId = item?.id || null;
            this.newItem = item ? { ...item, buy: item.price_buy, sell: item.price_sell, qty: item.stock } 
                               : { code: '', name: '', buy: 0, sell: 0, qty: 0 };
            this.modalOpen = true;
        },

        async saveItem() {
            if (this.isCodeDuplicate) {
                alert("Будь ласка, виправте помилку в коді товару");
                return;
            }
            const action = this.editId ? 'edit_item' : 'receive';
            const res = await API.request(action, 'POST', { ...this.newItem, id: this.editId }, this.user.storeId);
            if (res.error) return alert(res.error);
            this.modalOpen = false;
            await this.fetchData();
        },

        printInventory() {
            const itemsToPrint = this.inventory
                .filter(i => i.stock > 0)
                .sort((a, b) => a.name.localeCompare(b.name));
            
            const printWindow = window.open('', '_blank');
            if (!printWindow) return alert('Будь ласка, дозвольте спливаючі вікна для друку');

            const tableRows = itemsToPrint.map(item => `
                <tr>
                    <td>${item.code}</td>
                    <td>${item.name}</td>
                    <td style="text-align:center">${item.stock}</td>
                    <td></td>
                    <td></td>
                </tr>
            `).join('');
            
            const tableHtml = `
                <html>
                <head>
                    <title>Інвентаризація</title>
                    <style>
                        body { font-family: sans-serif; padding: 20px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th, td { border: 1px solid #000; padding: 8px; font-size: 12px; }
                        th { background: #eee; }
                        .footer { margin-top: 30px; font-size: 12px; }
                    </style>
                </head>
                <body>
                    <h2 style="text-align:center">Інвентаризаційний опис</h2>
                    <p style="text-align:center">Магазин: ${this.user.storeName} | Дата: ${new Date().toLocaleDateString()}</p>
                    <table>
                        <thead>
                            <tr>
                                <th>Код</th>
                                <th>Назва</th>
                                <th>Облік</th>
                                <th style="width:80px">Факт</th>
                                <th style="width:150px">Примітка</th>
                            </tr>
                        </thead>
                        <tbody>${tableRows}</tbody>
                    </table>
                    <div class="footer">
                        <p>Всього найменувань: ${itemsToPrint.length}</p>
                        <p>Підпис: ___________________________</p>
                    </div>
                    <script>
                        window.onload = function() { 
                            setTimeout(() => { window.print(); window.close(); }, 500); 
                        };
                    </script>
                </body>
                </html>
            `;
            
            printWindow.document.write(tableHtml);
            printWindow.document.close();
        },

        openEmpModal(emp = null) {
            this.editEmpId = emp?.id || null;
            this.newEmp = emp ? { ...emp } : { name: '', position: '' };
            this.empModalOpen = true;
        },

        async saveEmployee() {
            const action = this.editEmpId ? 'edit_employee' : 'add_employee';
            await API.request(action, 'POST', { ...this.newEmp, id: this.editEmpId }, this.user.storeId);
            this.empModalOpen = false;
            await this.fetchData();
        }
    };
}