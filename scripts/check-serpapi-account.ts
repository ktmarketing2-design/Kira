import fetch from 'node-fetch';

const key = '4ab11904a25a07c1320ef45b4109ca828e833446059d0f7356c9a8d9a26ff48e';

async function run() {
  const url = `https://serpapi.com/account?api_key=${key}`;
  console.log('Querying:', url);
  const res = await fetch(url);
  console.log('Status:', res.status);
  const text = await res.text();
  console.log('Response:', text);
}

run().catch(console.error);
