;; Test drawing for the PDF Takeoff: a multileader with an overall scale (inches, INSUNITS 1). Its Standard style is set
;; to text height 0.8 at scale 8, so AutoCAD draws its text 6.4" high (CONTEXT_DATA 41 = 6.4, 40 = 8) — a reader that
;; scales the stored height again shows it 51.2" high. An MTEXT 6.4" high stands beside it for comparison.
;;   accoreconsole /i <new drawing> /s make_zd_mleader.scr   -> zd_mleader_2018.dwg and zd_mleader_2018.dxf
(setvar "CMDECHO" 0)
(setvar "INSUNITS" 1) (setvar "LUNITS" 4) (setvar "MEASUREMENT" 0)
(defun zd:style (/ d e)
  (setq d (dictsearch (namedobjdict) "ACAD_MLEADERSTYLE")
        e (cdr (assoc -1 (dictsearch (cdr (assoc -1 d)) "Standard"))))
  (entmod (subst (cons 45 0.8) (assoc 45 (entget e)) (subst (cons 142 8.0) (assoc 142 (entget e)) (entget e)))))
(zd:style)
(setvar "CMLEADERSTYLE" "Standard")
(command "_.MLEADER" "_T" "SLAB OPENING" "" "_non" "0,0" "_non" "48,24")   ; (pre-enter Text: the console has no in-place editor)
(entmake '((0 . "MTEXT") (100 . "AcDbEntity") (8 . "0") (100 . "AcDbMText") (10 120.0 24.0 0.0) (40 . 6.4) (71 . 1) (1 . "REFERENCE 6.4")))
(entmake '((0 . "LINE") (8 . "0") (10 0.0 -24.0 0.0) (11 240.0 -24.0 0.0)))
