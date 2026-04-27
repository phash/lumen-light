import { BrowserRouter, Routes, Route } from "react-router-dom";
import Header from "./components/Header";
import Landing from "./pages/Landing";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Editor from "./pages/Editor";
import Account from "./pages/Account";

export default function App() {
  return (
    <BrowserRouter>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/editor" element={<Editor />} />
          <Route path="/account" element={<Account />} />
        </Routes>
      </main>
    </BrowserRouter>
  );
}
