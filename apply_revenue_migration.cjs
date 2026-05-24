const fs = require('fs');

const url = "https://chwopnsmykwzqflqozvf.functions.supabase.co/db-bridge";
const apiKey = "pl4npl1npl3npl3n";

async function run() {
  const sql = fs.readFileSync('d:/Documents/Bisnis/FizaTalk/supabase/migrations/20260524110000_add_revenue_charts_to_admin_dashboard.sql', 'utf8');
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey
    },
    body: JSON.stringify({
      action: "sql_execute",
      sql: sql.trim()
    })
  });
  
  if (!response.ok) {
    const text = await response.text();
    console.error(`HTTP ${response.status}: ${text}`);
    return;
  }
  const data = await response.json();
  console.log(JSON.stringify(data, null, 2));
}

run();
