import {MongoMemoryReplSet} from 'mongodb-memory-server';
import {MongoClient} from 'mongodb';
import {spawn} from 'node:child_process';
import bcrypt from 'bcryptjs';
const repl=await MongoMemoryReplSet.create({replSet:{count:1},binary:{version:'7.0.24'}});
const client=new MongoClient(repl.getUri());await client.connect();await client.db('heaven_bus').collection('users').insertOne({_id:'local-admin' as any,email:'admin@heaven.test',name:'Heaven Admin',password:await bcrypt.hash('Local-test-password-2026',12),role:'admin'});await client.close();
const child=spawn('node',['--import','tsx','server/index.ts'],{stdio:'inherit',env:{...process.env,MONGODB_URI:repl.getUri(),MONGODB_DB:'heaven_bus',JWT_SECRET:'local-only-test-secret-at-least-32-characters',SEED_DEMO:'true',PAYMENT_MODE:'sandbox',FRONTEND_URL:'http://localhost:5173',PORT:'4000'}});
async function stop(){child.kill('SIGTERM');await repl.stop();process.exit(0);}process.on('SIGTERM',stop);process.on('SIGINT',stop);
