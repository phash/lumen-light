mod common;
use common::example;
use lumen_plugin_manifest::expr::{EvalEnv, Expr, ExprContext, Value, eval, parse_expr, typecheck};
use lumen_plugin_manifest::{ManifestError, Origin, validate};

fn env<'a>(f: &'a dyn Fn(&str) -> Option<Value>) -> EvalEnv<'a> {
    EvalEnv {
        params: f,
        selection: 0,
        editor: true,
        library: false,
    }
}

#[test]
fn beispiel_ausdruecke() {
    let zero = |p: &str| (p == "strength").then_some(Value::Num(0.0));
    let some = |p: &str| (p == "strength").then_some(Value::Num(35.0));
    assert!(eval(&parse_expr("strength == 0").unwrap(), &env(&zero)));
    assert!(!eval(&parse_expr("strength == 0").unwrap(), &env(&some)));
    assert!(eval(&parse_expr("strength > 0").unwrap(), &env(&some)));
}

#[test]
fn vorrang() {
    let e = parse_expr("!a || b && c").unwrap();
    let a = Expr::Ident("a".into());
    let b = Expr::Ident("b".into());
    let c = Expr::Ident("c".into());
    assert_eq!(
        e,
        Expr::Or(
            Box::new(Expr::Not(Box::new(a))),
            Box::new(Expr::And(Box::new(b), Box::new(c)))
        )
    );
}

#[test]
fn skip_when_nur_params() {
    let m = example();
    let e = parse_expr("selection > 0").unwrap();
    assert!(typecheck(&e, &m.params, ExprContext::SkipWhen).is_err());
    assert!(typecheck(&e, &m.params, ExprContext::EnabledWhen).is_ok());
}

#[test]
fn typfehler() {
    let m = example();
    let e = parse_expr("chroma-only > 3").unwrap();
    assert!(typecheck(&e, &m.params, ExprContext::EnabledWhen).is_err());
    let e = parse_expr("strength == \"hoch\"").unwrap();
    assert!(typecheck(&e, &m.params, ExprContext::EnabledWhen).is_err());
    let e = parse_expr("strength").unwrap();
    assert!(
        typecheck(&e, &m.params, ExprContext::EnabledWhen).is_err(),
        "Zahl ist kein Wahrheitswert"
    );
}

#[test]
fn grenzen() {
    let m = example();
    assert!(parse_expr(&format!("strength == {}", "1".repeat(250))).is_err());
    assert!(parse_expr("(((((((((strength == 0)))))))))").is_err());
    assert!(parse_expr("((((((((strength == 0))))))))").is_ok());
    let e = parse_expr("unbekannt == 1").unwrap();
    assert!(typecheck(&e, &m.params, ExprContext::EnabledWhen).is_err());
    assert!(parse_expr("strength ==").is_err());
    assert!(parse_expr("strength = 1").is_err());
}

#[test]
fn param_ids_mit_bindestrich() {
    assert_eq!(
        parse_expr("chroma-only == true").unwrap(),
        Expr::Cmp(
            lumen_plugin_manifest::expr::CmpOp::Eq,
            Box::new(Expr::Ident("chroma-only".into())),
            Box::new(Expr::Bool(true))
        )
    );
    assert_eq!(
        format!("{:?}", parse_expr("-1 < strength").unwrap()),
        "Cmp(Lt, Num(-1.0), Ident(\"strength\"))"
    );
}

#[test]
fn validator_prueft_ausdruecke() {
    let mut m = example();
    m.contributes.gpu_chain[0].skip_when = Some("selection > 0".into());
    let e = validate(&m, Origin::Dev).unwrap_err();
    assert!(
        e.iter().any(|x| matches!(
            x,
            ManifestError::Expr {
                field: "skip-when",
                ..
            }
        )),
        "{e:?}"
    );
    let mut m = example();
    m.contributes.command[0].enabled_when = Some("strength >".into());
    let e = validate(&m, Origin::Dev).unwrap_err();
    assert!(
        e.iter().any(|x| matches!(
            x,
            ManifestError::Expr {
                field: "enabled-when",
                ..
            }
        )),
        "{e:?}"
    );
}
