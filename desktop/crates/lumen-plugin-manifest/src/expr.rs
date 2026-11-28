//! Ausdrucks-Minisprache fuer `skip-when` und `enabled-when` (EBNF der Spec).
//! Ohne Seiteneffekte; laenge <= 256 Zeichen, Klammertiefe <= 8.

use std::collections::BTreeMap;

use crate::ids::is_param_id;
use crate::model::{ParamDecl, ParamKind};

pub const MAX_LEN: usize = 256;
pub const MAX_DEPTH: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CmpOp {
    Eq,
    Ne,
    Lt,
    Le,
    Gt,
    Ge,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Or(Box<Expr>, Box<Expr>),
    And(Box<Expr>, Box<Expr>),
    Not(Box<Expr>),
    Cmp(CmpOp, Box<Expr>, Box<Expr>),
    Num(f64),
    Bool(bool),
    Str(String),
    Ident(String),
}

#[derive(Debug, Clone, PartialEq, thiserror::Error)]
pub enum ExprError {
    #[error("Ausdruck länger als {MAX_LEN} Zeichen")]
    TooLong,
    #[error("Ausdruck tiefer als {MAX_DEPTH} Klammerebenen")]
    TooDeep,
    #[error("Syntaxfehler bei Zeichen {0}")]
    Syntax(usize),
    #[error("unbekannter Name `{0}`")]
    UnknownIdent(String),
    #[error("`{0}` ist hier nicht erlaubt")]
    NotAllowed(String),
    #[error("Typfehler: {0}")]
    Type(String),
}

#[derive(Debug, Clone, PartialEq)]
enum Tok {
    Num(f64),
    Str(String),
    Ident(String),
    Op(&'static str),
    LParen,
    RParen,
}

const OPS: &[&str] = &["||", "&&", "==", "!=", "<=", ">=", "<", ">", "!"];

fn lex(s: &str) -> Result<Vec<(usize, Tok)>, ExprError> {
    let b = s.as_bytes();
    let mut out: Vec<(usize, Tok)> = Vec::new();
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        if c.is_ascii_whitespace() {
            i += 1;
            continue;
        }
        let start = i;
        // Minus ist nur Vorzeichen einer Zahl, und nur dort, wo ein Atom beginnt.
        let atom_start = !matches!(
            out.last(),
            Some((_, Tok::Num(_) | Tok::Ident(_) | Tok::Str(_) | Tok::RParen))
        );
        if c.is_ascii_digit()
            || (c == b'-' && atom_start && b.get(i + 1).is_some_and(u8::is_ascii_digit))
        {
            i += 1;
            while i < b.len() && b[i].is_ascii_digit() {
                i += 1;
            }
            if i < b.len() && b[i] == b'.' {
                i += 1;
                let frac = i;
                while i < b.len() && b[i].is_ascii_digit() {
                    i += 1;
                }
                if i == frac {
                    return Err(ExprError::Syntax(i));
                }
            }
            let n = s[start..i].parse().map_err(|_| ExprError::Syntax(start))?;
            out.push((start, Tok::Num(n)));
        } else if c.is_ascii_lowercase() {
            while i < b.len()
                && (b[i].is_ascii_lowercase() || b[i].is_ascii_digit() || b[i] == b'-')
            {
                i += 1;
            }
            let id = &s[start..i];
            if !is_param_id(id) {
                return Err(ExprError::Syntax(start));
            }
            out.push((start, Tok::Ident(id.to_string())));
        } else if c == b'"' {
            i += 1;
            while i < b.len() && b[i] != b'"' {
                if b[i] == b'\\' {
                    return Err(ExprError::Syntax(i));
                }
                i += 1;
            }
            if i >= b.len() {
                return Err(ExprError::Syntax(start));
            }
            out.push((start, Tok::Str(s[start + 1..i].to_string())));
            i += 1;
        } else if c == b'(' {
            out.push((start, Tok::LParen));
            i += 1;
        } else if c == b')' {
            out.push((start, Tok::RParen));
            i += 1;
        } else if let Some(op) = OPS.iter().find(|o| s[i..].starts_with(**o)) {
            out.push((start, Tok::Op(op)));
            i += op.len();
        } else {
            return Err(ExprError::Syntax(start));
        }
    }
    Ok(out)
}

struct Parser {
    toks: Vec<(usize, Tok)>,
    pos: usize,
    depth: usize,
    len: usize,
}

impl Parser {
    fn peek(&self) -> Option<&Tok> {
        self.toks.get(self.pos).map(|(_, t)| t)
    }
    fn at(&self) -> usize {
        self.toks.get(self.pos).map_or(self.len, |(p, _)| *p)
    }
    fn eat_op(&mut self, op: &'static str) -> bool {
        let hit = self.peek() == Some(&Tok::Op(op));
        self.pos += usize::from(hit);
        hit
    }
    fn or(&mut self) -> Result<Expr, ExprError> {
        let mut l = self.and()?;
        while self.eat_op("||") {
            l = Expr::Or(Box::new(l), Box::new(self.and()?));
        }
        Ok(l)
    }
    fn and(&mut self) -> Result<Expr, ExprError> {
        let mut l = self.unary()?;
        while self.eat_op("&&") {
            l = Expr::And(Box::new(l), Box::new(self.unary()?));
        }
        Ok(l)
    }
    fn unary(&mut self) -> Result<Expr, ExprError> {
        if self.eat_op("!") {
            return Ok(Expr::Not(Box::new(self.unary()?)));
        }
        self.cmp()
    }
    fn cmp(&mut self) -> Result<Expr, ExprError> {
        let l = self.atom()?;
        let op = match self.peek() {
            Some(Tok::Op("==")) => CmpOp::Eq,
            Some(Tok::Op("!=")) => CmpOp::Ne,
            Some(Tok::Op("<")) => CmpOp::Lt,
            Some(Tok::Op("<=")) => CmpOp::Le,
            Some(Tok::Op(">")) => CmpOp::Gt,
            Some(Tok::Op(">=")) => CmpOp::Ge,
            _ => return Ok(l),
        };
        self.pos += 1;
        Ok(Expr::Cmp(op, Box::new(l), Box::new(self.atom()?)))
    }
    fn atom(&mut self) -> Result<Expr, ExprError> {
        let at = self.at();
        let t = self.peek().cloned().ok_or(ExprError::Syntax(at))?;
        self.pos += 1;
        Ok(match t {
            Tok::Num(n) => Expr::Num(n),
            Tok::Str(s) => Expr::Str(s),
            Tok::Ident(i) if i == "true" => Expr::Bool(true),
            Tok::Ident(i) if i == "false" => Expr::Bool(false),
            Tok::Ident(i) => Expr::Ident(i),
            Tok::LParen => {
                self.depth += 1;
                if self.depth > MAX_DEPTH {
                    return Err(ExprError::TooDeep);
                }
                let e = self.or()?;
                if self.peek() != Some(&Tok::RParen) {
                    return Err(ExprError::Syntax(self.at()));
                }
                self.pos += 1;
                self.depth -= 1;
                e
            }
            _ => return Err(ExprError::Syntax(at)),
        })
    }
}

pub fn parse_expr(s: &str) -> Result<Expr, ExprError> {
    if s.chars().count() > MAX_LEN {
        return Err(ExprError::TooLong);
    }
    let mut p = Parser {
        toks: lex(s)?,
        pos: 0,
        depth: 0,
        len: s.len(),
    };
    let e = p.or()?;
    if p.pos != p.toks.len() {
        return Err(ExprError::Syntax(p.at()));
    }
    Ok(e)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExprContext {
    /// Nur eigene Params und Literale.
    SkipWhen,
    /// Zusaetzlich `selection`, `editor`, `library`.
    EnabledWhen,
}

#[derive(Debug, Clone, PartialEq)]
enum Ty {
    Num,
    Bool,
    /// Choice-Param mit erlaubten IDs.
    Choice(Vec<String>),
    StrLit(String),
}

fn ty(e: &Expr, params: &BTreeMap<String, ParamDecl>, ctx: ExprContext) -> Result<Ty, ExprError> {
    let tyerr = |m: &str| ExprError::Type(m.to_string());
    let want_bool = |e: &Expr| -> Result<(), ExprError> {
        match ty(e, params, ctx)? {
            Ty::Bool => Ok(()),
            _ => Err(tyerr("Wahrheitswert erwartet")),
        }
    };
    Ok(match e {
        Expr::Or(a, b) | Expr::And(a, b) => {
            want_bool(a)?;
            want_bool(b)?;
            Ty::Bool
        }
        Expr::Not(a) => {
            want_bool(a)?;
            Ty::Bool
        }
        Expr::Num(_) => Ty::Num,
        Expr::Bool(_) => Ty::Bool,
        Expr::Str(s) => Ty::StrLit(s.clone()),
        Expr::Ident(i) => match (i.as_str(), params.get(i)) {
            (_, Some(p)) => match p.kind {
                ParamKind::Float | ParamKind::Int => Ty::Num,
                ParamKind::Bool => Ty::Bool,
                ParamKind::Choice => {
                    Ty::Choice(p.choices.iter().flatten().map(|c| c.id.clone()).collect())
                }
                ParamKind::Curve => {
                    return Err(tyerr("Kurven-Params sind in Ausdrücken nicht erlaubt"));
                }
            },
            ("selection" | "editor" | "library", None) if ctx == ExprContext::SkipWhen => {
                return Err(ExprError::NotAllowed(i.clone()));
            }
            ("selection", None) => Ty::Num,
            ("editor" | "library", None) => Ty::Bool,
            _ => return Err(ExprError::UnknownIdent(i.clone())),
        },
        Expr::Cmp(op, a, b) => {
            let (ta, tb) = (ty(a, params, ctx)?, ty(b, params, ctx)?);
            let ordered = !matches!(op, CmpOp::Eq | CmpOp::Ne);
            match (&ta, &tb) {
                (Ty::Num, Ty::Num) => {}
                (Ty::Bool, Ty::Bool) if !ordered => {}
                (Ty::Choice(ids), Ty::StrLit(s)) | (Ty::StrLit(s), Ty::Choice(ids)) if !ordered => {
                    if !ids.contains(s) {
                        return Err(tyerr("unbekannte Auswahl-ID"));
                    }
                }
                _ => return Err(tyerr("Vergleich passt nicht zu den Typen")),
            }
            Ty::Bool
        }
    })
}

/// Prueft Namen und Typen; das Ergebnis muss ein Wahrheitswert sein.
pub fn typecheck(
    e: &Expr,
    params: &BTreeMap<String, ParamDecl>,
    ctx: ExprContext,
) -> Result<(), ExprError> {
    match ty(e, params, ctx)? {
        Ty::Bool => Ok(()),
        _ => Err(ExprError::Type("Wahrheitswert erwartet".into())),
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Num(f64),
    Bool(bool),
    Str(String),
}

pub struct EvalEnv<'a> {
    pub params: &'a dyn Fn(&str) -> Option<Value>,
    pub selection: u32,
    pub editor: bool,
    pub library: bool,
}

fn value(e: &Expr, env: &EvalEnv) -> Option<Value> {
    Some(match e {
        Expr::Num(n) => Value::Num(*n),
        Expr::Bool(b) => Value::Bool(*b),
        Expr::Str(s) => Value::Str(s.clone()),
        Expr::Ident(i) => match i.as_str() {
            "selection" => Value::Num(env.selection as f64),
            "editor" => Value::Bool(env.editor),
            "library" => Value::Bool(env.library),
            p => return (env.params)(p),
        },
        other => Value::Bool(eval(other, env)),
    })
}

/// Wertet einen (typgeprueften) Ausdruck aus. Fehlende Werte ergeben `false`.
pub fn eval(e: &Expr, env: &EvalEnv) -> bool {
    match e {
        Expr::Or(a, b) => eval(a, env) || eval(b, env),
        Expr::And(a, b) => eval(a, env) && eval(b, env),
        Expr::Not(a) => !eval(a, env),
        Expr::Cmp(op, a, b) => {
            let (Some(x), Some(y)) = (value(a, env), value(b, env)) else {
                return false;
            };
            match (x, y) {
                (Value::Num(x), Value::Num(y)) => match op {
                    CmpOp::Eq => x == y,
                    CmpOp::Ne => x != y,
                    CmpOp::Lt => x < y,
                    CmpOp::Le => x <= y,
                    CmpOp::Gt => x > y,
                    CmpOp::Ge => x >= y,
                },
                (x, y) => match op {
                    CmpOp::Eq => x == y,
                    CmpOp::Ne => x != y,
                    _ => false,
                },
            }
        }
        other => matches!(value(other, env), Some(Value::Bool(true))),
    }
}
