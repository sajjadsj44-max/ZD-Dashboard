;; Test drawing for the PDF Takeoff: text and leaders as AutoCAD draws them (inches, INSUNITS 1).
;; - TEXT 10 high in Times New Roman, ROMANS.SHX and Swiss 721 Condensed: AutoCAD's own widths (Times "HHHHHHHHHH" 106.6 to the
;;   advance; ROMANS "20'-6" WIDE RAMP" 143.8 ink; Swiss Condensed "HHHHHHHHHH" 76.1 ink)
;; - an MTEXT 12 high in Times New Roman boxed 147.73 wide — its ink is 147.2, so AutoCAD keeps it on one line
;; - a LEADER whose own dimension overrides (DIMASZ 42, DIMLDRBLK _OPEN) give it a 42" open arrowhead: AutoCAD keeps those as
;;   ACAD DSTYLE xdata on the leader
;;   accoreconsole /s make_zd_text.scr   -> zd_text_2018.dwg and zd_text_2018.dxf
(setvar "CMDECHO" 0)
(setvar "INSUNITS" 1) (setvar "LUNITS" 4) (setvar "MEASUREMENT" 0)
(defun zd:style (nm font)
  (entmake (list '(0 . "STYLE") '(100 . "AcDbSymbolTableRecord") '(100 . "AcDbTextStyleTableRecord") (cons 2 nm) '(70 . 0) '(40 . 0.0) '(41 . 1.0) '(50 . 0.0) '(71 . 0) '(42 . 10.0) (cons 3 font) '(4 . ""))))
(zd:style "ZD-TIMES" "times.ttf") (zd:style "ZD-ROMANS" "romans.shx") (zd:style "ZD-SWISSC" "swissc.ttf")
(entmake '((0 . "TEXT") (8 . "0") (10 0.0 0.0 0.0) (40 . 10.0) (1 . "HHHHHHHHHH") (7 . "ZD-TIMES")))
(entmake '((0 . "TEXT") (8 . "0") (10 0.0 -30.0 0.0) (40 . 10.0) (1 . "20'-6\" WIDE RAMP") (7 . "ZD-ROMANS")))
(entmake '((0 . "TEXT") (8 . "0") (10 0.0 -60.0 0.0) (40 . 10.0) (1 . "HHHHHHHHHH") (7 . "ZD-SWISSC")))
(entmake '((0 . "MTEXT") (100 . "AcDbEntity") (8 . "0") (100 . "AcDbMText") (10 0.0 -90.0 0.0) (40 . 12.0) (41 . 147.73) (71 . 1) (7 . "STANDARD") (1 . "{\\fTimes New Roman|b0|i0|c0|p18;20'-6\" WIDE RAMP}")))
(setvar "DIMASZ" 42.0) (setvar "DIMLDRBLK" "_OPEN")
(command "_.LEADER" "_non" "300,0" "_non" "200,0" "" "" "_N")
