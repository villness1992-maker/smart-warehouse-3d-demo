import React,{useState,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import WarehouseApp from './WarehouseApp';
import './globals.css';
function App(){
 const [section,setSection]=useState(location.hash.slice(1)||'home');
 useEffect(()=>{const change=()=>{setSection(location.hash.slice(1)||'home');window.scrollTo(0,0)};window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change)},[]);
 return <WarehouseApp section={section}/>;
}
createRoot(document.getElementById('root')!).render(<App/>);
